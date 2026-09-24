// Tab "Setup" of an own event (#263): the proposal, the orga's changes, the
// approval. Kept calm on purpose — group cards with one compact line per
// raider, the bench beside them and a narrow column with only what decides
// the evening (roles against the plan, buffs, fairness, wishes, "nicht
// zusammen" — asked once, counts only, never names). Why somebody
// stands where they do is the line's tooltip, the weights sit behind a dialog,
// and so does Claude's explanation.
//
// Moving: drag a raider onto a group, onto the bench or onto another raider
// (swap — inside one group that reorders it; every group always shows its five
// places). Without a mouse: activate a raider (click, Enter), then the target.
// Every move is saved at once and comes back valued by the server.
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
    approveRaidSetup, explainRaidSetup, getRaidSetup, getRaidSetupExplain, proposeRaidSetup, publishRaidSetup, saveRaidSetup, saveSetupPingText, updateRaidSize,
    type ApiError, type SetupAttendance, type SetupEditorData, type SetupEditorGroup, type SetupPerson, type SetupPlacementInput, type StoredSetup,
} from "../../api";
import {
    applyLocal, benchChunks, dpsCheck, moveRaider, peopleOf, placeGrid, pingTextToSave, publishHint, resizeLineup, roleTarget, suggestGroup, tipReasons, toInput, toggleLock, withAllGroups, withSetupDefaults, GROUP_SIZE,
    type SetupTarget,
} from "../../lib/setupEditor";
import { wowIconUrl } from "../../lib/wowIcon";
import { roleLabel, rolePluralLabel, specLabel } from "../../lib/wowNames";
import { locale, t, useT } from "../../i18n";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { Modal, useConfirm } from "../../components/ui/Modal";
import RaidLoader from "../../components/ui/RaidLoader";
import WowIcon from "../../components/ui/WowIcon";
import { useJobs } from "../../components/Jobs";
import { CheckIcon, LockIcon, UnlockIcon } from "../../components/icons";
import { classColorProps } from "../../components/ClassSpec";
import SpecTile from "./SpecTile";
import type { RaidCtx } from "./meta";
import "../../styles/setup-editor.css";

/** The signup states a slot shows a marker for, in the active language. */
function statusLabel(status: string | undefined): string {
    if (status === "late") return t("setup.person.status.late");
    if (status === "tentative") return t("setup.person.status.tentative");
    if (status === "bench") return t("setup.person.status.bench");
    return "";
}

/** A raider's spec in the active language — the server's label as fallback. */
const specText = (p: SetupPerson) => specLabel(p.spec, p.specLabel || p.spec);

/** The weight sliders of the proposal, labels in the active language. */
function weightLabels(): { key: string; label: string; tip: string }[] {
    return [
        { key: "requiredBuffs", label: t("setup.weights.requiredBuffs.label"), tip: t("setup.weights.requiredBuffs.tip") },
        { key: "mainSpec", label: t("setup.weights.mainSpec.label"), tip: t("setup.weights.mainSpec.tip") },
        { key: "preferredCharacter", label: t("setup.weights.preferredCharacter.label"), tip: t("setup.weights.preferredCharacter.tip") },
        { key: "fairness", label: t("setup.weights.fairness.label"), tip: t("setup.weights.fairness.tip") },
        { key: "status", label: t("setup.weights.status.label"), tip: t("setup.weights.status.tip") },
        { key: "partyBuffs", label: t("setup.weights.partyBuffs.label"), tip: t("setup.weights.partyBuffs.tip") },
        { key: "wishes", label: t("setup.weights.wishes.label"), tip: t("setup.weights.wishes.tip") },
        { key: "avoid", label: t("setup.weights.avoid.label"), tip: t("setup.weights.avoid.tip") },
        { key: "raidBuffs", label: t("setup.weights.raidBuffs.label"), tip: t("setup.weights.raidBuffs.tip") },
        { key: "attendance", label: t("setup.weights.attendance.label"), tip: t("setup.weights.attendance.tip") },
        { key: "gear", label: t("setup.weights.gear.label"), tip: t("setup.weights.gear.tip") },
    ];
}

// the raid size an own event allows (eventStore.js's MAX_SIZE) — the server checks it again
const MAX_RAID_SIZE = 40;

const dateTime = (ms: number) => (ms
    ? new Date(ms).toLocaleString(locale(), { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "");

const ROLE_ICONS: Record<string, string> = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    melee: "ability_meleedamage",
    ranged: "ability_marksmanship",
};

/** Attendance bar tone: healthy from 80 %, worrying below 50 %. */
const attendanceTone = (pct: number) => (pct >= 80 ? "ok" : pct >= 50 ? "mid" : "bad");

/** The tooltip's attendance row: a bar, the percentage, how many raids, and how sure the character link is (check = confirmed, "auto" = guessed). */
function AttendanceRow({ a }: { a: SetupAttendance | undefined }) {
    const t = useT();
    const known = !!a && a.pct !== null;
    return (
        <div className="se-tip-row">
            <div className="se-tip-body">
                <span className="se-tip-k">{t("setup.person.tip.attendance")}</span>
                {known && a ? (
                    <>
                        <span className="se-tip-att">
                            <b className="se-num">{a.pct} %</b>
                            {a.link === "manual"
                                ? <span className="se-tip-link se-tip-linked"><CheckIcon /></span>
                                : <span className="se-tip-link se-tip-auto">{t("setup.person.tip.autoBadge")}</span>}
                        </span>
                        <span className={`se-tip-bar se-tip-${attendanceTone(a.pct as number)}`}><i style={{ width: `${a.pct}%` }} /></span>
                        <span className="se-tip-sub">{t("setup.person.tip.attendanceCount", { attended: a.attended, total: a.total })}</span>
                        <span className="se-tip-sub">{a.link === "manual" ? t("setup.person.tip.linkManual") : t("setup.person.tip.linkAuto")}</span>
                    </>
                ) : <span className="se-tip-sub">{t("setup.person.tip.attendanceNone")}</span>}
            </div>
        </div>
    );
}

/**
 * The raider panel, docked under the summary in the right column (never over a
 * group, always complete): spec and role with icons, Discord name, signup
 * status, attendance (for everybody, badged by how sure the character link
 * is), the buffs they bring as icons, and the reasons of the proposal. It shows
 * the raider the pointer touched last.
 */
function SlotTip({ p, attendance }: { p: SetupPerson; attendance: SetupAttendance | undefined | null }) {
    const t = useT();
    const color = classColorProps(p.classColor);
    const status = statusLabel(p.status);
    const brings = p.brings || [];
    const reasons = [...new Set(tipReasons(p.reasons))].filter((r) => r !== status);
    return (
        <aside className="se-tip" aria-label={t("setup.person.tip.aria")} aria-live="polite">
            {/* three columns: who they are and how often they came · what they bring · why they stand here */}
            <div className="se-tip-col">
                <div className="se-tip-head">
                    <SpecTile iconUrl={p.specIcon ? wowIconUrl(p.specIcon, 36) : undefined} classColor={p.classColor} />
                    <div className="se-tip-body">
                        <span className={`se-tip-name ${color.className || ""}`} style={color.style}>{p.character}</span>
                        <span className="se-tip-sub">
                            {p.role && <WowIcon name={ROLE_ICONS[p.role] || "inv_misc_questionmark"} size={14} />}
                            {[specText(p), p.role ? roleLabel(p.role) : "", p.main === false ? t("setup.person.offSpec") : ""].filter(Boolean).join(" · ")}
                        </span>
                        {(p.name || status) && (
                            <span className="se-tip-sub">
                                {p.name && <span>@{p.name}</span>}
                                {status && <span className={`se-tip-status se-st-${p.status}`}>{status}</span>}
                            </span>
                        )}
                    </div>
                </div>
                {attendance !== null && <AttendanceRow a={attendance} />}
            </div>
            <div className="se-tip-col">
                {brings.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k">{t("setup.person.tip.brings")}</span>
                        {brings.map((b) => (
                            <span key={`${b.scope}-${b.key}`} className="se-tip-buff">
                                <WowIcon name={b.icon} size={20} />
                                <span>
                                    {b.label}
                                    <small>{b.scope === "party" ? t("setup.person.tip.bringsGroup", { count: b.count }) : t("setup.person.tip.bringsRaid")}</small>
                                </span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="se-tip-col">
                {reasons.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k">{t("setup.person.tip.why")}</span>
                        <ul className="se-tip-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                )}
            </div>
        </aside>
    );
}

/** What the docked panel shows before any raider was touched. */
function TipEmpty() {
    const t = useT();
    return <aside className="se-tip se-tip-empty" aria-label={t("setup.person.tip.aria")}>{t("setup.person.tip.empty")}</aside>;
}

/**
 * The raid size, editable right in the bar (#354): a change reshuffles groups
 * and bench live in the browser (`resizeLineup`), then commits — on blur or
 * Enter, not per keystroke, so a half-typed number never triggers a reshuffle.
 * "Unsaved" shows for the moment the typed value differs from what is stored.
 */
function SizeControl({ size, disabled, onCommit }: { size: number; disabled: boolean; onCommit: (size: number) => void }) {
    const t = useT();
    // the size is entered as a number of groups; the total (groups times 5) is calculated
    const groups = Math.max(1, Math.ceil(size / GROUP_SIZE));
    const maxGroups = Math.floor(MAX_RAID_SIZE / GROUP_SIZE);
    const [text, setText] = useState(String(groups));
    useEffect(() => setText(String(groups)), [groups]);
    const parsed = Math.round(Number(text));
    const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed >= 1 && parsed <= maxGroups;
    const dirty = valid && parsed !== groups;
    const commit = () => {
        if (valid && parsed !== groups) onCommit(parsed * GROUP_SIZE);
        else setText(String(groups));
    };
    return (
        <label className="se-size" data-tip={t("setup.editor.sizeTip")} data-tip-sub={t("setup.editor.sizeSub")}>
            <span className="kicker">{t("setup.editor.sizeLabel")}</span>
            <input
                type="number" min={1} max={maxGroups} step={1} value={text} disabled={disabled}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                aria-label={t("setup.editor.sizeLabel")}
            />
            <span className="se-size-total">{t("setup.editor.sizeTotal", { size: (valid ? parsed : groups) * GROUP_SIZE, perGroup: GROUP_SIZE })}</span>
            {dirty && <span className="se-size-dirty" data-tip={t("setup.editor.sizeUnsavedTip")}>{t("setup.editor.sizeUnsaved")}</span>}
        </label>
    );
}

function StatusBadge({ setup }: { setup: StoredSetup }) {
    const t = useT();
    if (setup.status === "approved") {
        return (
            <Badge
                tone="ok" tip={t("setup.status.approved")}
                tipSub={setup.approvedAt ? t("setup.status.approvedSubSince", { time: dateTime(setup.approvedAt) }) : t("setup.status.approvedSub")}
            >
                {t("setup.status.approved")}
            </Badge>
        );
    }
    if (setup.changedSinceApproval) {
        return (
            <Badge tone="mid" tip={t("setup.status.changedTip")} tipSub={setup.approved ? t("setup.status.changedSubSince", { time: dateTime(setup.approved.approvedAt) }) : t("setup.status.changedSub")}>
                {t("setup.status.changed")}
            </Badge>
        );
    }
    const draft = <Badge tone="mid" tip={t("setup.status.draft")} tipSub={t("setup.status.draftSub")}>{t("setup.status.draft")}</Badge>;
    if (setup.origin !== "auto") return draft;
    return (
        <>
            {draft}
            <Badge tone="accent" tip={t("setup.status.autoTip")} tipSub={setup.updatedAt ? t("setup.status.autoSubAt", { time: dateTime(setup.updatedAt) }) : t("setup.status.autoSub")}>
                {t("setup.status.auto")}
            </Badge>
        </>
    );
}

type Interaction = {
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
    onLock: (userId: string) => void;
};

function Slot({ p, ui }: { p: SetupPerson; ui: Interaction }) {
    const t = useT();
    const status = statusLabel(p.status);
    const color = classColorProps(p.classColor);
    const selected = ui.selected === p.userId;
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
            className={`se-slot${selected ? " se-picked" : ""}${p.locked ? " se-locked" : ""}${ui.dragging === p.userId ? " se-dragging" : ""}`}
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
        >
            <SpecTile iconUrl={p.specIcon ? wowIconUrl(p.specIcon, 36) : undefined} classColor={p.classColor} />
            <span className="se-slot-text">
                <span className={`se-name ${color.className || ""}`} style={color.style}>{p.character}</span>
                <span className="se-sub">
                    {specText(p)}
                    {/* an off-spec role is tinted — "Zweitspec" itself is in the tooltip */}
                    {p.role && <> · <span className={p.main === false ? "se-offrole" : undefined}>{roleLabel(p.role)}</span></>}
                </span>
            </span>
            {status && <span className={`rd-sig rd-sig-${p.status}`} aria-label={status} />}
            {ui.editable && (
                <IconButton
                    className={`se-lock${p.locked ? " is-on" : ""}`}
                    size="sm"
                    icon={p.locked ? <LockIcon /> : <UnlockIcon />}
                    tip={p.locked ? t("setup.slot.locked") : t("setup.slot.lock")}
                    tipSub={p.locked ? t("setup.slot.lockedSub") : t("setup.slot.lockSub")}
                    aria-pressed={!!p.locked}
                    onClick={(e) => { e.stopPropagation(); ui.onLock(p.userId); }}
                    onKeyDown={(e) => e.stopPropagation()}
                />
            )}
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

function GroupCard({ group, buffs, ui }: { group: SetupEditorGroup; buffs: { key: string; label: string; icon: string }[]; ui: Interaction }) {
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
                    ? <Slot key={p.userId} p={p} ui={ui} />
                    : <FreePlace key={`free-${i + 1}`} group={group.index} pos={i + 1} pickable={ui.editable && !!ui.selected} ui={ui} />))}
            </div>
        </section>
    );
}

/** One 5-slot card of the bench (#354) — a group card's exact look, never a real group: no roles, no buffs, and dropping onto it always just means "onto the bench", wherever inside it lands. */
function BenchChunk({ index, slots, ui }: { index: number; slots: SetupPerson[]; ui: Interaction }) {
    const t = useT();
    const zone = useZone({ bench: true }, ui);
    const full = slots.length >= GROUP_SIZE;
    const canTake = ui.editable && !!ui.selected && !slots.some((s) => s.userId === ui.selected);
    const title = t("setup.bench.chunkTitle", { index });
    return (
        <section className={`se-group${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}`} {...zone.props} aria-label={title}>
            <GroupHeader title={title} count={slots.length} full={full} />
            <div className="se-slots">
                {slots.map((p) => <Slot key={p.userId} p={p} ui={ui} />)}
                {Array.from({ length: Math.max(0, GROUP_SIZE - slots.length) }, (_, i) => (canTake
                    ? (
                        <button key={`free-${i}`} type="button" className="se-ph se-ph-take" onClick={() => ui.onDrop({ bench: true })}>
                            {i === 0 ? t("setup.group.here") : ""}
                        </button>
                    )
                    : <span key={`free-${i}`} className="se-ph" aria-hidden="true">{slots.length + i + 1}</span>))}
            </div>
        </section>
    );
}

function BenchCard({ bench, ui }: { bench: SetupPerson[]; ui: Interaction }) {
    const t = useT();
    return (
        <section className="se-bench" aria-label={t("setup.bench.aria")}>
            <header className="se-bench-head">
                <span className="se-group-title">{t("setup.bench.title")}</span>
                <span className="se-count">{bench.length}</span>
            </header>
            <div className="se-groups se-bench-chunks">
                {benchChunks(bench).map((slots, i) => <BenchChunk key={i} index={i + 1} slots={slots} ui={ui} />)}
            </div>
        </section>
    );
}

function Stat({ label, value, target, ok, tip }: { label: string; value: number; target: string; ok: boolean; tip: string }) {
    const t = useT();
    return (
        <div className={`se-stat${ok ? "" : " se-off"}`} data-tip={target ? t("setup.summary.statTipTarget", { label, value, target }) : t("setup.summary.statTip", { label, value })} data-tip-sub={tip}>
            <span className="se-stat-v">{value}{target && <small>/{target}</small>}</span>
            <span className="kicker">{label}</span>
        </div>
    );
}

function Summary({ data, setup, busy, onFairness, onAvoid, onWeights }: {
    data: SetupEditorData;
    setup: StoredSetup;
    busy: boolean;
    onFairness: (on: boolean) => void;
    onAvoid: (on: boolean) => void;
    onWeights: () => void;
}) {
    const t = useT();
    const { checks } = setup;
    const roles = checks.roles || {};
    const tank = roles.tank || { count: 0, min: 0, max: 0, ok: true };
    const healer = roles.healer || { count: 0, min: 0, max: 0, ok: true };
    const dps = dpsCheck(roles);
    // the places the plan leaves for damage dealers: size minus the planned tanks and healers
    const dpsTarget = checks.size.size ? Math.max(0, checks.size.size - (tank.max ?? tank.min) - (healer.max ?? healer.min)) : 0;
    const missingRequired = checks.buffs.required.filter((b) => !b.present);
    const missingRaid = checks.buffs.raid.filter((b) => !b.present);
    const fairness = typeof setup.options?.fairness === "boolean" ? setup.options.fairness : data.event.fairness;
    const wishesOn = typeof setup.options?.wishes === "boolean" ? setup.options.wishes : data.event.wishes;
    // "nicht zusammen": only when there are such pairs among the signups; counts, never names
    const avoidOn = setup.options?.avoid === true;
    const avoidTotal = Math.max(data.avoidPairs || 0, setup.checks.avoid?.total || 0);
    const buffTip = [
        checks.buffs.required.length
            ? t("setup.summary.required", { list: checks.buffs.required.map((b) => `${b.present ? "✓" : "–"} ${b.label}`).join(", ") })
            : t("setup.summary.noRequired"),
        missingRaid.length ? t("setup.summary.missingRaid", { list: missingRaid.map((b) => b.label).join(", ") }) : t("setup.summary.allRaid"),
    ].join("\n");
    return (
        <aside className="se-side" aria-label={t("setup.summary.aria")}>
            <div className="se-stats">
                <Stat label={rolePluralLabel("tank")} value={tank.count} target={roleTarget(tank)} ok={tank.ok} tip={t("setup.summary.planTip")} />
                <Stat label={rolePluralLabel("healer")} value={healer.count} target={roleTarget(healer)} ok={healer.ok} tip={t("setup.summary.planTip")} />
                <Stat
                    label={t("setup.summary.dps")} value={dps.count} target={dpsTarget ? String(dpsTarget) : ""} ok={dps.ok && dps.count >= dpsTarget}
                    tip={t("setup.summary.dpsTip", { melee: roles.melee?.count || 0, ranged: roles.ranged?.count || 0 })}
                />
            </div>
            <div className="se-side-row">
                <span className="kicker">{t("setup.summary.buffs")}</span>
                {missingRequired.length
                    ? <Badge tone="bad" tip={t("setup.summary.requiredMissingTip")} tipSub={buffTip}>{t("setup.summary.requiredMissing", { count: missingRequired.length })}</Badge>
                    : (
                        <Badge tone={missingRaid.length ? "mid" : "ok"} tip={t("setup.summary.buffs")} tipSub={buffTip}>
                            {missingRaid.length ? t("setup.summary.raidMissing", { count: missingRaid.length }) : t("setup.summary.complete")}
                        </Badge>
                    )}
            </div>
            <div className="se-side-row">
                <span className="kicker" data-tip={t("setup.summary.fairness")} data-tip-sub={t("setup.summary.fairnessSub")}>{t("setup.summary.fairness")}</span>
                <label className="switch">
                    <input type="checkbox" checked={fairness} disabled={busy} onChange={() => onFairness(!fairness)} aria-label={t("setup.summary.fairnessAria")} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </label>
            </div>
            <div className="se-side-row">
                <span className="kicker">{t("setup.summary.wishes")}</span>
                {wishesOn
                    ? <span className="se-side-v" data-tip={t("setup.summary.wishesMet")} data-tip-sub={t("setup.summary.wishesMetSub")}>{checks.wishes.met}<small>/{checks.wishes.total}</small></span>
                    : <span className="se-side-off" data-tip={t("setup.summary.wishesOff")} data-tip-sub={t("setup.summary.wishesOffSub")}>{t("setup.summary.off")}</span>}
            </div>
            {avoidTotal > 0 && (
                <div className="se-side-row">
                    <span className="kicker" data-tip={t("setup.summary.avoid")} data-tip-sub={t("setup.summary.avoidSub", { count: avoidTotal })}>{t("setup.summary.avoid")}</span>
                    {avoidOn && !!setup.checks.avoid?.together && (
                        <Badge tone="mid" tip={t("setup.summary.avoidTogetherTip")} tipSub={t("setup.summary.avoidTogetherSub")}>
                            {t("setup.summary.avoidTogether", { count: setup.checks.avoid.together })}
                        </Badge>
                    )}
                    <label className="switch">
                        <input type="checkbox" checked={avoidOn} disabled={busy} onChange={() => onAvoid(!avoidOn)} aria-label={t("setup.summary.avoidAria")} />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </label>
                </div>
            )}
            <button type="button" className="se-weights-btn" onClick={onWeights} disabled={busy}>{t("setup.summary.weights")}</button>
            {!!setup.warnings.length && (
                <Badge tone="mid" tip={t("setup.summary.hintsTip")} tipSub={setup.warnings.join("\n")}>{t("setup.summary.hints", { count: setup.warnings.length })}</Badge>
            )}
        </aside>
    );
}

function WeightsModal({ open, onClose, data, setup, onApply }: {
    open: boolean;
    onClose: () => void;
    data: SetupEditorData;
    setup: StoredSetup;
    onApply: (weights: Record<string, number>) => void;
}) {
    const t = useT();
    const defaults = data.defaults?.weights || {};
    const max = data.defaults?.maxWeight || 500;
    const [values, setValues] = useState<Record<string, number>>({});
    useEffect(() => {
        if (open) setValues({ ...defaults, ...(setup.options?.weights || {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => defaults[k] !== v));
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_gear_01" tone="raids" kicker={t("setup.weightsModal.kicker")} title={t("setup.weightsModal.title")} width={520}
            hint={t("setup.weightsModal.hint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={() => setValues({ ...defaults })}>{t("setup.weightsModal.defaults")}</Button>
                    <Button icon="spell_holy_borrowedtime" onClick={() => onApply(changed)}>{t("setup.weightsModal.repropose")}</Button>
                </>
            )}
        >
            <div className="se-weights">
                {weightLabels().map((w) => (
                    <label key={w.key} className="se-weight">
                        <span className="se-weight-label" data-tip={w.label} data-tip-sub={w.tip}>{w.label}</span>
                        <input
                            type="range" min={0} max={max} step={10} value={values[w.key] ?? 0}
                            onChange={(e) => setValues((v) => ({ ...v, [w.key]: Number(e.target.value) }))}
                            aria-label={w.label}
                        />
                        <span className={`se-weight-v${defaults[w.key] !== values[w.key] ? " se-changed" : ""}`}>{values[w.key] ?? 0}</span>
                    </label>
                ))}
            </div>
        </Modal>
    );
}

function ExplainModal({ open, onClose, ctx, data, setup, onDone }: {
    open: boolean;
    onClose: () => void;
    ctx: RaidCtx;
    data: SetupEditorData;
    setup: StoredSetup;
    onDone: () => void;
}) {
    const t = useT();
    const jobs = useJobs();
    const [running, setRunning] = useState(false);
    const explanation = setup.explanation;
    const outdated = !!explanation && explanation.version !== setup.version;
    const start = async () => {
        setRunning(true);
        await jobs.run({ label: t("setup.explain.title"), detail: data.event.title, icon: "inv_scroll_03", expectedSeconds: 30 }, async () => {
            await explainRaidSetup(ctx.csrfToken, ctx.eventId);
            for (;;) {
                await new Promise((r) => setTimeout(r, 2000));
                const state = await getRaidSetupExplain(ctx.eventId);
                if (!state.job || state.job.status === "done") return state;
                if (state.job.status === "error") throw new Error(state.job.error || t("setup.explain.failed"));
            }
        });
        setRunning(false);
        onDone();
    };
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03" tone="raids" kicker={t("setup.explain.kicker")} title={t("setup.explain.title")} width={640}
            hint={t("setup.explain.hint")}
            footer={data.hasApiKey
                ? <Button variant="run" icon="spell_holy_borrowedtime" running={running} onClick={start}>{explanation ? t("setup.explain.recreate") : t("setup.explain.create")}</Button>
                : <Link className="btn btn-ghost" to="/settings?section=verbindungen">{t("setup.explain.addKey")}</Link>}
        >
            {!data.hasApiKey && <p className="se-note">{t("setup.explain.noKey")}</p>}
            {explanation
                ? (
                    <div className="se-explain">
                        <div className="se-explain-meta">
                            <Badge tone={outdated ? "mid" : "ok"}>{outdated ? t("setup.explain.outdated", { version: explanation.version }) : t("setup.explain.version", { version: explanation.version })}</Badge>
                            <span className="kicker">{dateTime(explanation.at)}</span>
                        </div>
                        <div className="se-explain-text">{explanation.text}</div>
                    </div>
                )
                : data.hasApiKey && <p className="se-note">{t("setup.explain.none")}</p>}
        </Modal>
    );
}

const clock = (ms: number) => {
    if (!ms) return "";
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    return d.toLocaleString(locale(), sameDay
        ? { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }
        : { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/**
 * One calm line under the bar (#290): before the approval what it will post and
 * send, after it what it did — the details in the tooltip, one "Setup posten".
 */
function PublishLine({ data, setup, busy, posting, onPost }: {
    data: SetupEditorData;
    setup: StoredSetup;
    busy: boolean;
    posting: boolean;
    onPost: () => void;
}) {
    const t = useT();
    const hint = publishHint(data.publish, setup.status === "approved", clock);
    if (!hint) return null;
    return (
        <div className={`se-publish${hint.tone ? ` se-publish-${hint.tone}` : ""}`}>
            <WowIcon name="inv_letter_15" size={18} />
            <span className="se-publish-text" data-tip={hint.tip} data-tip-sub={hint.sub}>{hint.text}</span>
            {!data.publish?.dmsEnabled && !hint.canPost && !data.publish?.cancelled && (
                <Link className="se-publish-link" to="/settings?section=kategorien">{t("setup.publishLine.enableDms")}</Link>
            )}
            {hint.canPost && (
                <Button
                    variant="ghost" size="sm" icon="inv_letter_15" running={posting || hint.running} disabled={busy}
                    data-tip={t("setup.publishLine.post")}
                    data-tip-sub={t("setup.publishLine.postSub")}
                    onClick={onPost}
                >
                    {t("setup.publishLine.post")}
                </Button>
            )}
        </div>
    );
}

/**
 * The text everyone placed gets pinged with when the setup is posted (matches
 * the "Ping everyone" modal on the Discord side) — a minor, always-visible
 * supplementary control. Commits on blur or Enter, never per keystroke.
 */
function PingTextField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (text: string) => void }) {
    const t = useT();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        const next = pingTextToSave(draft, value);
        if (next !== null) onSave(next);
    };
    return (
        <div className="se-pingtext">
            <span className="se-pingtext-label" data-tip={t("setup.pingText.tip")}>
                📢 {t("setup.pingText.title")}
            </span>
            <input
                type="text"
                className="se-pingtext-input"
                value={draft}
                maxLength={300}
                disabled={disabled}
                aria-label={t("setup.pingText.label")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
            />
            <span className="se-pingtext-hint">{t("setup.pingText.hint")}</span>
        </div>
    );
}

/** The approved lineup, read-only — what someone without write access sees. */
function ReadOnly({ data }: { data: SetupEditorData }) {
    const t = useT();
    const approved = data.approved;
    const ui: Interaction = { editable: false, selected: null, dragging: null, attendance: {}, suggest: null, onInspect: () => {}, onPick: () => {}, onDrop: () => {}, onDrag: () => {}, onLock: () => {} };
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

// The compact view (one-line raiders, narrower cards) is an option, off by default;
// the choice is a per-viewer convenience, so it lives in the browser only.
const COMPACT_KEY = "eh-setup-compact";
function readCompact(): boolean {
    try {
        return localStorage.getItem(COMPACT_KEY) === "1";
    } catch {
        return false;
    }
}
function storeCompact(on: boolean) {
    try {
        localStorage.setItem(COMPACT_KEY, on ? "1" : "0");
    } catch {
        // private window or blocked storage — the choice just is not remembered
    }
}

export default function SetupEditor({ ctx }: { ctx: RaidCtx }) {
    const t = useT();
    const jobs = useJobs();
    const ask = useConfirm();
    const [data, setData] = useState<SetupEditorData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    // the raider the docked panel shows: the one the pointer touched last
    const [inspected, setInspected] = useState<string | null>(null);
    const [dialog, setDialog] = useState<"weights" | "explain" | null>(null);
    const [posting, setPosting] = useState(false);
    const [compact, setCompact] = useState(readCompact);
    const toggleCompact = () => setCompact((on) => {
        storeCompact(!on);
        return !on;
    });
    const saving = useRef(0);

    const load = useCallback(() => {
        getRaidSetup(ctx.eventId).then((d) => { setData(d.setup ? { ...d, setup: withSetupDefaults(d.setup) } : d); setError(null); }).catch((e: ApiError) => setError(e));
    }, [ctx.eventId]);
    useEffect(load, [load]);

    useEffect(() => {
        if (!selected) return undefined;
        const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [selected]);

    const setup = data?.setup || null;

    // The DMs of an approval run on in the background: poll only their state, so
    // a move the orga makes meanwhile is never overwritten by an older lineup.
    const dmsRunning = data?.publish?.dms?.status === "running";
    useEffect(() => {
        if (!dmsRunning) return undefined;
        const timer = setInterval(() => {
            getRaidSetup(ctx.eventId)
                .then((next) => setData((prev) => (prev ? { ...prev, publish: next.publish } : prev)))
                .catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
    }, [dmsRunning, ctx.eventId]);

    // Moves come faster than answers. Every save waits for the one before it and
    // carries the version the server last confirmed, and the next move builds on
    // the lineup as drawn (current.data) — so quick moves never trip the
    // server's "changed in the meantime" check on their own.
    const current = useRef<SetupEditorData | null>(null);
    current.current = data;
    const confirmedVersion = useRef(0);
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    useEffect(() => { if (data?.setup && !saving.current) confirmedVersion.current = data.setup.version; }, [data]);

    /** A server answer, with the Discord names the page already knows (mutations do not resolve them again). */
    const withNames = (raw: SetupEditorData): SetupEditorData => {
        if (!raw.setup) return raw;
        const next = { ...raw, setup: withSetupDefaults(raw.setup) };
        const known = current.current?.setup ? peopleOf(current.current.setup) : new Map<string, SetupPerson>();
        const named = (p: SetupPerson) => (p.name ? p : { ...p, name: known.get(p.userId)?.name || "" });
        return { ...next, setup: { ...next.setup, groups: next.setup.groups.map((g) => ({ ...g, slots: g.slots.map(named) })), bench: next.setup.bench.map(named) } };
    };

    /** Answer of a mutating call: take the server's lineup, tell the parent the step changed. */
    const accept = (next: SetupEditorData, message?: string) => {
        if (next.setup) confirmedVersion.current = next.setup.version;
        // attendance is only read on the page load — keep it across the answers of moves
        setData({ ...withNames(next), attendance: next.attendance || current.current?.attendance });
        ctx.onChanged(message || "");
    };

    // `patch`: other top-level fields to redraw at once alongside the lineup —
    // only the resize uses it, to show the new size/group count instantly
    // instead of waiting for the server's answer.
    const save = (input: SetupPlacementInput, extra: { fairness?: boolean; avoid?: boolean } = {}, patch: Partial<SetupEditorData> = {}) => {
        const shown = current.current;
        if (!shown?.setup) return chain.current;
        const ticket = ++saving.current;
        setData({ ...shown, ...patch, setup: applyLocal(shown.setup, input) });
        chain.current = chain.current.then(async () => {
            try {
                const next = await saveRaidSetup(ctx.csrfToken, ctx.eventId, { ...input, ...extra, version: confirmedVersion.current });
                if (next.setup) confirmedVersion.current = next.setup.version;
                // only the last pending save redraws; earlier answers would flash an older lineup
                if (ticket === saving.current) {
                    saving.current = 0;
                    accept(next);
                }
            } catch (e) {
                saving.current = 0;
                jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
                load();
            }
        });
        return chain.current;
    };

    const move = (target: SetupTarget, userId?: string) => {
        const who = userId || selected;
        setSelected(null);
        setDragging(null);
        const shown = current.current;
        if (!who || !shown?.setup) return;
        const result = moveRaider(toInput(shown.setup), who, target, peopleOf(shown.setup), shown.event.size || 0);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        if (result.input) save(result.input);
    };

    const pick = (userId: string) => {
        if (!selected) return setSelected(userId);
        if (selected === userId) return setSelected(null);
        move({ userId });
    };

    /**
     * Resize the raid (#354): reshuffled locally at once (resizeLineup), then
     * persisted — the size itself through the event's own PATCH (the create
     * dialog's endpoint, `updateRaidSize`), the resulting lineup through the
     * usual setup save, so both land together.
     */
    const resize = async (newSize: number) => {
        const shown = current.current;
        if (!shown?.setup || newSize === shown.event.size) return;
        const groupCount = Math.max(1, Math.ceil(newSize / GROUP_SIZE));
        const resized = resizeLineup(toInput(shown.setup), newSize);
        // reshuffled at once, in the browser — no server round trip needed to see it
        setData({ ...shown, event: { ...shown.event, size: newSize }, groupCount, setup: applyLocal(shown.setup, resized) });
        setBusy(true);
        try {
            await chain.current;
            // the size itself first, so the lineup save below already reads it back applied
            await updateRaidSize(ctx.csrfToken, ctx.eventId, newSize);
            await save(resized, {}, { event: { ...shown.event, size: newSize }, groupCount });
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.sizeFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    /**
     * "Nicht zusammen": asked once per event, the first time a proposal is made
     * while such pairs stand among the signups. Afterwards the side column's
     * switch changes it; the server remembers the answer.
     */
    const avoidAnswer = async (): Promise<boolean | undefined> => {
        const shown = current.current;
        if (!shown?.avoidPairs || typeof shown.setup?.options?.avoid === "boolean") return undefined;
        return ask({
            title: t("setup.avoid.askTitle"),
            text: t("setup.avoid.askText", { count: shown.avoidPairs }),
            action: t("setup.avoid.askYes"),
            cancelLabel: t("setup.avoid.askNo"),
            icon: "achievement_guildperk_everybodysfriend",
        });
    };

    const propose = async (weights?: Record<string, number>) => {
        setDialog(null);
        const avoid = await avoidAnswer();
        setBusy(true);
        await chain.current;
        const next = await jobs.run({ label: t("setup.editor.proposalJob"), detail: data?.event.title || "", icon: "inv_misc_map_01", quiet: true }, () => (
            proposeRaidSetup(ctx.csrfToken, ctx.eventId, { ...(weights ? { weights } : {}), ...(avoid === undefined ? {} : { avoid }) })
        ));
        setBusy(false);
        if (next) accept(next, next.message);
    };

    const approve = async () => {
        if (!setup) return;
        if (!setup.checks.ok) {
            const okay = await ask({
                title: t("setup.editor.approveAnywayTitle"),
                text: t("setup.editor.approveAnywayText"),
                action: t("setup.editor.approve"),
                icon: "inv_misc_map_01",
            });
            if (!okay) return;
        }
        setBusy(true);
        try {
            // approve what is drawn: wait for the moves still on their way first
            await chain.current;
            const next = await approveRaidSetup(ctx.csrfToken, ctx.eventId, confirmedVersion.current);
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.approveFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    const post = async () => {
        setPosting(true);
        try {
            await chain.current;
            const next = await publishRaidSetup(ctx.csrfToken, ctx.eventId);
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.postFailed"), "err");
            load();
        } finally {
            setPosting(false);
        }
    };

    const savePingText = async (text: string) => {
        try {
            const next = await saveSetupPingText(ctx.csrfToken, ctx.eventId, text);
            setData((prev) => (prev ? { ...prev, pingText: next.pingText } : prev));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
        }
    };

    if (error) return <div className="empty">{t("setup.editor.loadFailed", { message: error.message })}</div>;
    if (!data) return <RaidLoader text={t("setup.editor.loading")} compact />;
    if (!data.canWrite) return <ReadOnly data={data} />;

    if (!setup) {
        return (
            <div className="se-start">
                <WowIcon name="inv_misc_map_01" size={40} />
                <div>
                    <div className="se-start-title">{t("setup.editor.noSetup")}</div>
                    <div className="se-start-sub">
                        {[
                            t("setup.editor.signedUp", { count: data.signupCount || 0 }),
                            data.absent ? t("setup.editor.absent", { count: data.absent }) : "",
                            t("setup.editor.places", { count: data.event.size }),
                        ].filter(Boolean).join(" · ")}
                    </div>
                </div>
                <Button icon="spell_holy_borrowedtime" running={busy} disabled={!data.signupCount} onClick={() => propose()}>{t("setup.editor.createProposal")}</Button>
            </div>
        );
    }

    // the glow: where the raider being dragged (or picked) helps a group most
    const moving = dragging || selected;
    const movingPerson = moving ? peopleOf(setup).get(moving) : undefined;
    const suggest = movingPerson ? suggestGroup(movingPerson, withAllGroups(setup.groups, data.groupCount || 1)) : null;
    // looked up fresh every render, so a move redraws the panel's group and buffs
    const inspectedPerson = inspected ? peopleOf(setup).get(inspected) : undefined;
    const ui: Interaction = { editable: !busy, selected, dragging, attendance: data.attendance || {}, suggest, onInspect: setInspected, onPick: pick, onDrop: move, onDrag: setDragging, onLock: (userId) => save(toggleLock(toInput(current.current?.setup || setup), userId)) };
    const groups = withAllGroups(setup.groups, data.groupCount || 1);
    const partyBuffs = setup.checks.buffs.party;
    const lockedCount = [...setup.groups.flatMap((g) => g.slots), ...setup.bench].filter((p) => p.locked).length;
    const size = setup.checks.size;

    return (
        <div className={`se-editor${compact ? " se-compact" : ""}`}>
            <div className="se-bar">
                <StatusBadge setup={setup} />
                <SizeControl size={data.event.size} disabled={busy} onCommit={resize} />
                <Badge
                    tone={size.ok ? undefined : "mid"} tip={t("setup.editor.placesTip")}
                    tipSub={t("setup.editor.placesSub", { count: size.count, size: size.size, bench: setup.bench.length })}
                >
                    {t("setup.editor.placesBadge", { count: size.count, size: size.size })}
                </Badge>
                {lockedCount > 0 && (
                    <Badge tone="accent" icon={<LockIcon />} tip={t("setup.editor.lockedTip")} tipSub={t("setup.editor.lockedSub")}>
                        {t("setup.editor.locked", { count: lockedCount })}
                    </Badge>
                )}
                <span className="se-bar-hint">
                    {selected ? t("setup.editor.pickTarget") : t("setup.editor.dragHint")}
                </span>
                <div className="se-bar-act">
                    <Button
                        variant="ghost" size="sm" icon="inv_misc_book_09" aria-pressed={compact}
                        data-tip={t("setup.editor.compact")} data-tip-sub={t("setup.editor.compactSub")}
                        onClick={toggleCompact}
                    >
                        {t("setup.editor.compact")}
                    </Button>
                    <Button variant="ghost" size="sm" icon="inv_scroll_03" onClick={() => setDialog("explain")}>{t("setup.editor.explain")}</Button>
                    <Button variant="ghost" size="sm" icon="spell_holy_borrowedtime" disabled={busy} onClick={() => propose()}>{t("setup.editor.repropose")}</Button>
                    <Button size="sm" icon="achievement_guildperk_everybodysfriend" disabled={busy || setup.status === "approved"} onClick={approve}>
                        {setup.status === "approved" ? t("setup.editor.approved") : t("setup.editor.approve")}
                    </Button>
                </div>
            </div>
            <PublishLine data={data} setup={setup} busy={busy} posting={posting} onPost={post} />
            {/* the top area: left the ping message over the evening's numbers, right the raider panel (the one the pointer touched last) — one fixed height */}
            <div className="se-topline">
                <div className="se-topleft">
                    <PingTextField value={data.pingText || ""} disabled={busy} onSave={savePingText} />
                    <Summary
                        data={data} setup={setup} busy={busy}
                        onFairness={(on) => save(toInput(current.current?.setup || setup), { fairness: on })}
                        onAvoid={(on) => save(toInput(current.current?.setup || setup), { avoid: on })}
                        onWeights={() => setDialog("weights")}
                    />
                </div>
                {inspectedPerson ? <SlotTip p={inspectedPerson} attendance={data.attendance ? data.attendance[inspectedPerson.userId] : undefined} /> : <TipEmpty />}
            </div>

            <div className="se-layout">
                {/* the setup on top, the bench under a divider */}
                <div className="se-main">
                    <div className="se-groups">
                        {groups.map((g) => (
                            <GroupCard key={g.index} group={g} ui={ui} buffs={partyBuffs.filter((b) => b.groups.includes(g.index))} />
                        ))}
                    </div>
                    <BenchCard bench={setup.bench} ui={ui} />
                </div>
            </div>

            <WeightsModal open={dialog === "weights"} onClose={() => setDialog(null)} data={data} setup={setup} onApply={(w) => propose(w)} />
            <ExplainModal open={dialog === "explain"} onClose={() => setDialog(null)} ctx={ctx} data={data} setup={setup} onDone={load} />
        </div>
    );
}
