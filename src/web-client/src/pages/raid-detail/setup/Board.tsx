import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { SetupAttendance, SetupConfirmation, SetupEditorData, SetupEditorGroup, SetupPerson } from "../../../api";
import { benchChunks, placeGrid, withAllGroups, GROUP_SIZE, type SetupTarget } from "../../../lib/setupEditor";
import { wowIconUrl } from "../../../lib/wowIcon";
import { roleLabel } from "../../../lib/wowNames";
import { useT } from "../../../i18n";
import WowIcon from "../../../components/ui/WowIcon";
import { CheckIcon, LockIcon, XIcon } from "../../../components/icons";
import { classColorProps } from "../../../components/ClassSpec";
import SpecTile from "../SpecTile";
import { specText, statusLabel } from "./setupText";

/** Melee and ranged go without saying on a raider's line (the spec tells it); tank and healer are named. */
const showsRole = (role: string | undefined) => role === "tank" || role === "healer";

export type Interaction = {
    editable: boolean;
    selected: string | null;
    dragging: string | null;
    /** Attendance by user id, for the tooltips. */
    attendance: Record<string, SetupAttendance>;
    /** The group that suits the raider being dragged or picked — glows softly. */
    suggest: number | null;
    /** The pointer or focus reached a raider — the docked panel shows them. */
    onInspect: (userId: string) => void;
    onPick: (userId: string) => void;
    onDrop: (target: SetupTarget, userId?: string) => void;
    onDrag: (userId: string | null) => void;
    /** raiders marked as an extra tank / healer, by user id */
    extraRoles: Record<string, string[]>;
    /** "Anmeldung bearbeiten" (#521): a right click opens it (the button sits in the raider panel); missing = read-only. */
    onEdit?: (userId: string) => void;
    /** Confirm/Cancel by user id (the raiders' clicks under the setup message and the orga's marks) — drawn on group slots only. */
    confirmations?: Record<string, SetupConfirmation>;
    /** The raider the panel holds on to (clicked last, no move pending) — framed, so it is clear whose panel it is. */
    pinned?: string | null;
};

/**
 * One raider line — nothing on it to click but the line itself (pick, drag,
 * right click): fixing, the check and "Anmeldung bearbeiten" are buttons in the
 * raider panel (SlotTip), so they can never sit under the name or the mark.
 * `inPool` (#517): signed up, not in the setup, a "Bank" signup marked.
 * `inGroup`: a place in a group — only there a Confirm/Cancel is drawn (green resp. red, the mark as a big icon behind the line).
 */
function Slot({ p, ui, inPool = false, inGroup = false }: { p: SetupPerson; ui: Interaction; inPool?: boolean; inGroup?: boolean }) {
    const t = useT();
    const status = statusLabel(p.status);
    const color = classColorProps(p.classColor);
    const selected = ui.selected === p.userId;
    const confirmation = inGroup ? (ui.confirmations || {})[p.userId] : undefined;
    const inspect = () => ui.onInspect(p.userId);
    const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ui.onPick(p.userId);
        }
    };
    const drop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        ui.onDrop({ userId: p.userId }, e.dataTransfer.getData("text/plain"));
    };
    return (
        <div
            className={`se-slot${selected ? " se-picked" : ""}${!selected && ui.pinned === p.userId ? " se-pinned" : ""}${p.locked ? " se-locked" : ""}${ui.dragging === p.userId ? " se-dragging" : ""}${confirmation ? ` se-${confirmation}` : ""}`}
            role={ui.editable ? "button" : undefined}
            tabIndex={ui.editable ? 0 : undefined}
            aria-pressed={ui.editable ? selected : undefined}
            draggable={ui.editable}
            data-user={p.userId}
            onMouseEnter={inspect}
            onFocus={inspect}
            onClick={ui.editable ? () => ui.onPick(p.userId) : undefined}
            onKeyDown={ui.editable ? keyDown : undefined}
            // the dimmed look is set a tick later: changing the dragged element inside dragstart makes Chrome cancel the drag
            onDragStart={ui.editable ? (e) => { inspect(); e.dataTransfer.setData("text/plain", p.userId); e.dataTransfer.effectAllowed = "move"; setTimeout(() => ui.onDrag(p.userId), 0); } : undefined}
            onDragEnd={ui.editable ? () => ui.onDrag(null) : undefined}
            onDragOver={ui.editable ? (e) => e.preventDefault() : undefined}
            onDrop={ui.editable ? drop : undefined}
            onContextMenu={ui.editable && ui.onEdit ? (e) => { e.preventDefault(); ui.onEdit?.(p.userId); } : undefined}
        >
            <SpecTile iconUrl={p.specIcon ? wowIconUrl(p.specIcon, 36) : undefined} classColor={p.classColor} />
            <span className="se-slot-text">
                <span className={`se-name ${color.className || ""}`} style={color.style}>{p.character}</span>
                <span className="se-sub">
                    {/* first, so a long spec text never cuts it off (#517) */}
                    {inPool && p.status === "bench" && <span className="se-extra se-extra-lead" data-tip={t("setup.pool.benchSignupTip")}>{t("setup.pool.benchSignup")}</span>}
                    {/* the role only where the spec does not say it on its own: tank and healer, never melee/ranged.
                        An off-spec is tinted — the role where it is shown, else the spec; "Zweitspec" itself is in the tooltip */}
                    {showsRole(p.role)
                        ? <>{specText(p)} · <span className={p.main === false ? "se-offrole" : undefined}>{roleLabel(p.role)}</span></>
                        : <span className={p.main === false ? "se-offrole" : undefined}>{specText(p)}</span>}
                    {(ui.extraRoles[p.userId] || []).map((r) => (
                        <span key={r} className="se-extra" data-tip={t("setup.extra.tip", { role: roleLabel(r) })}>{t(`setup.extra.short.${r}`)}</span>
                    ))}
                </span>
            </span>
            {status && <span className={`rd-sig rd-sig-${p.status}`} aria-label={status} />}
            {confirmation && (
                <span className="se-confirm-mark" role="img" aria-label={t(`setup.slot.${confirmation}`)}>
                    {confirmation === "confirmed" ? <CheckIcon /> : <XIcon />}
                </span>
            )}
            {/* a fixed place only shows it — the panel's button changes it */}
            {p.locked && !inPool && <span className="se-lock-mark" role="img" aria-label={t("setup.slot.locked")}><LockIcon /></span>}
        </div>
    );
}

/** A drop zone: a group card or the bench. Click/Enter moves the picked raider here. */
function useZone(target: SetupTarget, ui: Interaction) {
    const [over, setOver] = useState(false);
    return {
        over,
        props: ui.editable ? {
            onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setOver(true); },
            onDragLeave: () => setOver(false),
            onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setOver(false); ui.onDrop(target, e.dataTransfer.getData("text/plain")); },
        } : {},
    };
}

/**
 * Shared header for GroupCard and BenchChunk (#358 feedback): title centered and a bit
 * bigger on its own row (with the count badge to the side, styled like the summary's
 * big-number stats), party buffs — if any were passed at all — on a second row below,
 * full width. That second row can wrap within itself without ever pushing the title
 * off-center or making one card's title row taller than its neighbors'. Passing `buffs`
 * as `undefined` (BenchChunk) omits the row entirely; passing `[]` (an empty real group)
 * still reserves it, so every real group card's header is the same height regardless of
 * how many buffs that particular group happens to have.
 */
function GroupHeader({ title, count, full, buffs }: { title: string; count: number; full: boolean; buffs?: { key: string; label: string; icon: string }[] }) {
    const t = useT();
    return (
        <header className="se-group-head">
            <div className="se-group-head-top">
                <span className="se-group-title">{title}</span>
                <span className={`se-count se-num${full ? " se-full" : ""}`}>{count}<small>/{GROUP_SIZE}</small></span>
            </div>
            {buffs && (
                <div className="se-group-buffs-row">
                    <span className="se-group-buffs">
                        {buffs.map((b) => (
                            <span key={b.key} className="se-buff" data-tip={b.label} data-tip-sub={t("setup.group.buffSub")}>
                                <WowIcon name={b.icon} size={18} />
                            </span>
                        ))}
                    </span>
                </div>
            )}
        </header>
    );
}

/**
 * One free place of a group. A raider dropped on it (or picked and then chosen
 * with "Hierher") stands exactly there — not just somewhere in the group.
 */
function FreePlace({ group, pos, pickable, ui }: { group: number; pos: number; pickable: boolean; ui: Interaction }) {
    const t = useT();
    const [over, setOver] = useState(false);
    if (pickable) {
        return (
            <button type="button" className="se-ph se-ph-take" onClick={() => ui.onDrop({ group, pos })}>
                {t("setup.group.here")} <small>{pos}</small>
            </button>
        );
    }
    if (!ui.editable) return <span className="se-ph" aria-hidden="true">{pos}</span>;
    return (
        <span
            className={`se-ph${over ? " se-ph-over" : ""}`}
            aria-hidden="true"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); ui.onDrop({ group, pos }, e.dataTransfer.getData("text/plain")); }}
        >
            {pos}
        </span>
    );
}

export function GroupCard({ group, buffs, ui }: { group: SetupEditorGroup; buffs: { key: string; label: string; icon: string }[]; ui: Interaction }) {
    const t = useT();
    const zone = useZone({ group: group.index }, ui);
    const full = group.slots.length >= GROUP_SIZE;
    const canTake = ui.editable && !!ui.selected && !group.slots.some((s) => s.userId === ui.selected);
    return (
        <section className={`se-group${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}${ui.suggest === group.index ? " se-suggest" : ""}`} {...zone.props} aria-label={t("setup.group.title", { index: group.index })}>
            <GroupHeader title={t("setup.group.title", { index: group.index })} count={group.slots.length} full={full} buffs={buffs} />
            {/* always five places, each where the orga put its raider — a free one takes a drop of its own (place 5 of a group of two) */}
            <div className="se-slots">
                {placeGrid(group.slots).map((p, i) => (p
                    ? <Slot key={p.userId} p={p} ui={ui} inGroup />
                    : <FreePlace key={`free-${i + 1}`} group={group.index} pos={i + 1} pickable={ui.editable && !!ui.selected} ui={ui} />))}
            </div>
        </section>
    );
}

/**
 * One 5-slot card of the bench (#354) or of the pool "Angemeldet" (#517) — a group card's exact look, never a real
 * group: no roles, no buffs, and dropping onto it always just means "onto the bench" resp. "back into the pool",
 * wherever inside it lands.
 */
function BenchChunk({ index, slots, ui, pool = false }: { index: number; slots: SetupPerson[]; ui: Interaction; pool?: boolean }) {
    const t = useT();
    const zone = useZone(pool ? { pool: true } : { bench: true }, ui);
    const full = slots.length >= GROUP_SIZE;
    const canTake = ui.editable && !!ui.selected && !slots.some((s) => s.userId === ui.selected);
    const title = t(pool ? "setup.pool.chunkTitle" : "setup.bench.chunkTitle", { index });
    return (
        <section className={`se-group${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}`} {...zone.props} aria-label={title}>
            <GroupHeader title={title} count={slots.length} full={full} />
            <div className="se-slots">
                {slots.map((p) => <Slot key={p.userId} p={p} ui={ui} inPool={pool} />)}
                {Array.from({ length: Math.max(0, GROUP_SIZE - slots.length) }, (_, i) => (canTake
                    ? (
                        <button key={`free-${i}`} type="button" className="se-ph se-ph-take" onClick={() => ui.onDrop(pool ? { pool: true } : { bench: true })}>
                            {i === 0 ? t("setup.group.here") : ""}
                        </button>
                    )
                    : <span key={`free-${i}`} className="se-ph" aria-hidden="true">{slots.length + i + 1}</span>))}
            </div>
        </section>
    );
}

export function BenchCard({ bench, ui }: { bench: SetupPerson[]; ui: Interaction }) {
    const t = useT();
    return (
        <section className="se-bench" aria-label={t("setup.bench.aria")}>
            <header className="se-bench-head" data-tip={t("setup.bench.title")} data-tip-sub={t("setup.bench.tip")}>
                <span className="se-group-title">{t("setup.bench.title")}</span>
                <span className="se-count">{bench.length}</span>
            </header>
            <div className="se-groups se-bench-chunks">
                {benchChunks(bench).map((slots, i) => <BenchChunk key={i} index={i + 1} slots={slots} ui={ui} />)}
            </div>
        </section>
    );
}

/**
 * "Angemeldet" (#517): everybody signed up who is neither in a group nor on the
 * bench — drawn like the bench, never posted. Dragging somebody here takes them
 * out of the setup again.
 */
export function PoolCard({ pool, ui }: { pool: SetupPerson[]; ui: Interaction }) {
    const t = useT();
    return (
        <section className="se-bench se-pool" aria-label={t("setup.pool.aria")}>
            <header className="se-bench-head" data-tip={t("setup.pool.title")} data-tip-sub={t("setup.pool.tip")}>
                <span className="se-group-title">{t("setup.pool.title")}</span>
                <span className="se-count">{pool.length}</span>
            </header>
            <div className="se-groups se-bench-chunks">
                {benchChunks(pool).map((slots, i) => <BenchChunk key={i} index={i + 1} slots={slots} ui={ui} pool />)}
            </div>
        </section>
    );
}

/** The approved lineup, read-only — what someone without write access sees. */
export function ReadOnly({ data }: { data: SetupEditorData }) {
    const t = useT();
    const approved = data.approved;
    const ui: Interaction = { editable: false, selected: null, dragging: null, attendance: {}, extraRoles: {}, suggest: null, onInspect: () => {}, onPick: () => {}, onDrop: () => {}, onDrag: () => {} };
    if (!approved) return <p className="rd-empty">{t("setup.readOnly.notApproved")}</p>;
    const groupCount = Math.max(1, Math.ceil((data.event.size || 0) / GROUP_SIZE));
    return (
        <div className="se-layout se-readonly">
            <div className="se-main">
                <div className="se-groups">
                    {withAllGroups(approved.groups, groupCount).map((g) => <GroupCard key={g.index} group={g} buffs={[]} ui={ui} />)}
                </div>
                <BenchCard bench={approved.bench} ui={ui} />
            </div>
        </div>
    );
}
