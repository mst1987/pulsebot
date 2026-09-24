import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Flyout from "../../../components/raidplan/Flyout";
import AssignModal from "./AssignModal";
import TypeBadge from "./TypeBadge";
import { AlertTriangle, ArrowRight, Copy, Link2, Pencil, RotateCcw, EyeOff, Swords, ChevronDown, Users, ChevronLeft, ChevronRight, Plus, ScrollText, StickyNote, Trash2, Wand2, X } from "lucide-react";
import { suggestRaidplan, type ApiError, type RaidplanAssignment, type Catalog, type RaidplanAssignTarget, type RaidplanBoard, type RaidplanMobRef, type RaidplanPlayer } from "../../../api";
import { IconButton, useConfirm } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { useToast } from "../../../components/Jobs";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import {
    ALL_MARKS, CARD_ORDER, SCOPE_TYPES, classIconOf, outOfClass, playersByClass, ASSIGN_META, mobTarget, spellRef, spellsFor, ROLE_ICON, iconForTask, iconForText, isMe, SUGGESTABLE, addRowOfType, addableCards, applySuggestions, cardTypes, fitsType, hideCard, isDefaultCard, removeCard, showCard, isMine, rowsOfType, moveAssignee, patchAssignment, removeAssignment,
    resolveAssignee, resolveTarget, slotChoices, toggleAssignee, toggleTarget, type AssignCtx, type Resolved,
} from "../../../lib/assign";
import { wowIconUrl } from "../../../lib/wowIcon";
import { canRestore, deviate, hideInherited, restoreInherited } from "../../../lib/inherit";
import { portraitUrl } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/** A mob's icon: a boss image (boss:N), a portrait (mob:N), a WoW icon by name, or the generic enemy symbol. */
export function MobIcon({ icon, size = 18 }: { icon: string; size?: number }) {
    if (portraitUrl(icon)) return <img className="rp-mobicon" src={portraitUrl(icon)} alt="" width={size} height={size} draggable={false} />;
    if (icon) return <img className="rp-mobicon" src={wowIconUrl(icon, size > 24 ? 56 : 36)} alt="" width={size} height={size} draggable={false} />;
    return <span className="rp-mobicon rp-mobicon-generic" style={{ width: size, height: size }} aria-hidden="true"><Swords size={Math.round(size * 0.66)} /></span>;
}

/** One assignee or target as a small chip: who it is now (icon and name), or the placeholder / mark / text. */
export function AssignChip({ r, mine, onRemove, extra }: { r: Resolved; mine?: boolean; onRemove?: () => void; extra?: ReactNode }) {
    const t = useT();
    const body = r.player ? (
        <>
            <TokenIcon player={r.player} size="sm" />
            {r.kind === "slot" && <span className="rp-achip-slot">{r.label}</span>}
            <PlayerName player={r.player} />
        </>
    ) : r.kind === "mark" ? (
        <><MarkIcon mark={r.mark as never} size={18} /><span>{r.label}</span></>
    ) : r.kind === "mob" ? (
        <><MobIcon icon={r.icon} size={18} /><span>{r.label}</span></>
    ) : r.kind === "group" ? (
        <><Users size={15} aria-hidden="true" /><span>{r.label}</span></>
    ) : r.kind === "text" ? (
        <><WowIcon name={iconForText(r.label) || "inv_misc_note_01"} size={18} /><span>{r.label}</span></>
    ) : (
        <>
            {r.kind === "slot" && ROLE_ICON[r.role] && <WowIcon name={ROLE_ICON[r.role]} size={18} />}
            <span className={r.open ? "rp-achip-open" : ""}>{r.label}{r.open && r.kind === "slot" ? ` (${t("raidBoard.slot.open")})` : ""}</span>
        </>
    );
    return (
        <span className={`rp-achip rp-achip-${r.kind}${mine ? " is-own" : ""}`}>
            {extra}{body}
            {onRemove && <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={onRemove}><X size={12} /></button>}
        </span>
    );
}

export type Option = { key: string; label: string; node: ReactNode; on: boolean; group: string };

/** A "+" that opens the picker beside the card (Flyout.tsx): a grid of chips in sections, several can be ticked, nothing scrolls. */
export function ChipPicker({ options, onToggle, textPlaceholder, onText, label, multi = true }: {
    options: Option[];
    onToggle: (key: string) => void;
    textPlaceholder?: string;
    onText?: (text: string) => void;
    label: string;
    multi?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const btn = useRef<HTMLButtonElement>(null);
    return (
        <span className="rp-picker">
            <button ref={btn} type="button" className="rp-achip rp-achip-add" aria-label={label} aria-expanded={open} aria-haspopup="dialog" data-tip={label} onClick={() => setOpen((v) => !v)}><Plus size={14} /></button>
            {open && <Flyout anchor={btn.current} title={label} options={options} onToggle={onToggle} onClose={() => setOpen(false)} multi={multi} onText={onText} textPlaceholder={textPlaceholder} />}
        </span>
    );
}

/** A slot as a compact chip of a picker: the role's icon (the player's spec icon when somebody stands in it) and its number. */
export function SlotPickChip({ r, n }: { r: Resolved; n: number }) {
    return (
        <span className="rp-pchip">
            {r.player ? <TokenIcon player={r.player} size="sm" /> : <WowIcon name={ROLE_ICON[r.role] || ROLE_ICON.dps} size={18} />}
            <b>{n}</b>
        </span>
    );
}

/** One row inside a card: two compact lines — the task and its buttons, then who -> what. */
const SPELL_TYPES = ["curse", "thunderclap", "demoshout", "md", "ss", "fearward", "kick", "dispel", "cc", "buff", "tank"];
const MOB_TYPES = ["tank", "trashtank", "special", "cc", "kick", "dispel", "other"];

function AssignRow({ a, canWrite, ctx, edit, spellOptions, noteOpen, onNote, onEdit }: {
    a: RaidplanAssignment;
    canWrite: boolean;
    ctx: AssignCtx;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    spellOptions: (a: RaidplanAssignment) => Option[];
    noteOpen: boolean;
    onNote: () => void;
    /** Opens the row's dialog (who, at what, which class). */
    onEdit: (id: string) => void;
}) {
    const t = useT();
    const rotation = a.type === "kick" && a.assignees.length > 1;
    const showNote = a.note !== "" || noteOpen;
    return (
        <li className="rp-arow">
            <div className="rp-arow-top">
                {!(SPELL_TYPES.indexOf(a.type) >= 0 && a.spell) && <WowIcon name={iconForTask(a)} size={22} />}
                {SPELL_TYPES.indexOf(a.type) >= 0 && (a.spell ? (
                    <span className="rp-achip rp-spellchip" data-tip={a.spell.name}>
                        <WowIcon name={a.spell.icon || iconForTask({ ...a, spell: null })} size={18} /><span>{a.spell.name}</span>
                        {canWrite && <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={() => edit((b) => patchAssignment(b, a.id, { spell: null }))}><X size={12} /></button>}
                    </span>
                ) : canWrite && spellOptions(a).length > 0 && (
                    <IconButton size="sm" icon={<Plus size={14} />} tip={t("raidBoard.assign.pickSpell")} onClick={() => onEdit(a.id)} />
                ))}
                {canWrite ? (
                    <input
                        className="rp-atitle" value={a.title} maxLength={80} placeholder={t(`raidBoard.assign.type.${a.type}`)} aria-label={t("raidBoard.assign.task")}
                        onChange={(e) => edit((b) => patchAssignment(b, a.id, { title: e.target.value }))}
                    />
                ) : <span className="rp-atitle-read">{a.title || t(`raidBoard.assign.type.${a.type}`)}</span>}
                {canWrite && !showNote && <IconButton size="sm" icon={<StickyNote size={14} />} tip={t("raidBoard.assign.addNote")} onClick={onNote} />}
                {canWrite && <IconButton size="sm" tone="danger" icon={<Trash2 size={14} />} tip={t("raidBoard.assign.delete")} onClick={() => edit((b) => removeAssignment(b, a.id))} />}
            </div>
            <div className="rp-arow-main">
                <span className="rp-achips" role="group" aria-label={t("raidBoard.assign.assignees")}>
                    {(a.preferredClasses || []).length > 0 && (
                        <span className="rp-classhint" data-tip={(a.preferredClasses || []).map((c) => t(`wow.class.${c}`)).join(", ")}>
                            {(a.preferredClasses || []).map((c) => <WowIcon key={c} name={classIconOf(c)} size={18} />)}
                        </span>
                    )}
                    {a.assignees.map((ref, i) => (
                        <AssignChip
                            key={ref} r={resolveAssignee(ref, ctx)}
                            extra={<>{rotation ? <span className="rp-achip-no">{i + 1}</span> : null}{outOfClass(a, resolveAssignee(ref, ctx).player) && <AlertTriangle size={12} className="rp-oop" aria-label={t("raidBoard.assign.outOfClass")} data-tip={t("raidBoard.assign.outOfClass")} />}</>}
                            onRemove={canWrite ? () => edit((b) => toggleAssignee(b, a.id, ref)) : undefined}
                        />
                    ))}
                    {rotation && canWrite && (
                        <span className="rp-arot">
                            {a.assignees.map((ref, i) => (
                                <span key={ref} className="rp-arot-one">
                                    <button type="button" aria-label={t("raidBoard.assign.earlier")} disabled={i === 0} onClick={() => edit((b) => moveAssignee(b, a.id, ref, -1))}><ChevronLeft size={12} /></button>
                                    <button type="button" aria-label={t("raidBoard.assign.later")} disabled={i === a.assignees.length - 1} onClick={() => edit((b) => moveAssignee(b, a.id, ref, 1))}><ChevronRight size={12} /></button>
                                </span>
                            ))}
                        </span>
                    )}
                    {canWrite && <button type="button" className="rp-achip rp-achip-add" aria-label={t("raidBoard.assign.addAssignee")} data-tip={t("raidBoard.assign.addAssignee")} onClick={() => onEdit(a.id)}><Plus size={14} /></button>}
                </span>
                <span className="rp-aarrow" aria-hidden="true"><ArrowRight size={14} /></span>
                <span className="rp-achips" role="group" aria-label={t("raidBoard.assign.targets")}>
                    {a.targets.map((tg) => (
                        <AssignChip key={`${tg.kind}|${tg.ref}`} r={resolveTarget(tg, ctx)} onRemove={canWrite ? () => edit((b) => toggleTarget(b, a.id, tg)) : undefined} />
                    ))}
                    {canWrite && <button type="button" className="rp-achip rp-achip-add" aria-label={t("raidBoard.assign.addTarget")} data-tip={t("raidBoard.assign.addTarget")} onClick={() => onEdit(a.id)}><Plus size={14} /></button>}
                </span>
            </div>
            {showNote && (canWrite ? (
                <input
                    className="rp-anote" value={a.note} maxLength={200} placeholder={t("raidBoard.assign.note")} aria-label={t("raidBoard.assign.note")}
                    onChange={(e) => edit((b) => patchAssignment(b, a.id, { note: e.target.value }))}
                />
            ) : <span className="rp-muted">{a.note}</span>)}
        </li>
    );
}

/**
 * "Einteilungen": one card per type, side by side in a grid (Tanken, Heilung, Unterbrecher ...). A
 * card has its head (type icon, name, count, suggest for this type, "+" for a row, fold) and compact
 * two-line rows. Every area has default cards that are there even when empty (boss: Tanken,
 * Heilung; trash: Tank -> Marker, Heilung; general: Flüche, Donnerknall, Demoralisierender Ruf);
 * the others appear with their first row or through "Karte hinzufügen". The old task rows are
 * rows of the type "other".
 */
export default function AssignPanel({ scope, board, edit, roster, players, isEvent, canWrite, eventId, csrfToken, groupCount, links, onLinks, profileName, onPickProfile, catalog, sectionMobs, inherited = [], defaultRows = [], onCopyDefaults }: {
    scope: string;
    board: RaidplanBoard;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    roster: RaidplanPlayer[];
    players: Map<string, RaidplanPlayer>;
    isEvent: boolean;
    canWrite: boolean;
    eventId: string;
    csrfToken: string | null;
    groupCount: number;
    links: boolean;
    onLinks: (on: boolean) => void;
    profileName: string;
    onPickProfile: () => void;
    catalog: Catalog | null;
    sectionMobs: RaidplanMobRef[];
    /** the rows this section inherits from the template's Standard (resolved for it), shown in their cards and not editable in place */
    inherited?: RaidplanAssignment[];
    /** the Standard's own rows (to restore a card) */
    defaultRows?: RaidplanAssignment[];
    /** in the Standard's own editor: writes its rows into every boss that does not differ (asks first) */
    onCopyDefaults?: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState("");
    const [noteOpen, setNoteOpen] = useState<string[]>([]);
    const [extra, setExtra] = useState<string[]>([]);
    const [folded, setFolded] = useState<string[]>([]);
    const [editing, setEditing] = useState("");
    const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
    const ctx: AssignCtx = useMemo(() => ({ slots: board.slots, players, catalog }), [board.slots, players, catalog]);
    const slots = useMemo(() => slotChoices(board.slots), [board.slots]);
    const spellRefOf = (id: string) => { const sp = (catalog ? catalog.spells : []).find((x) => x.id === id); return sp ? spellRef(sp) : null; };
    const groups = Array.from({ length: Math.max(1, groupCount) }, (_, i) => i + 1);
    // another boss brings its own hand-added cards
    useEffect(() => { setExtra([]); setFolded([]); }, [scope, eventId]);

    const ask = useConfirm();
    const shown = cardTypes(scope, [...board.assignments, ...inherited], extra, !canWrite, board.hiddenCards);
    const addable = addableCards(scope, shown);

    /** A new row of a card's type; a tanking row of a boss starts with the boss as its target. */
    const newRow = (b: RaidplanBoard, type: string): RaidplanBoard => {
        const made = addRowOfType(b, type);
        const boss = (scope === "boss" || scope === "defaults") && type === "tank" ? sectionMobs.find((m) => m.id.indexOf("b:") === 0) : undefined;
        return boss ? toggleTarget(made.board, made.id, mobTarget(boss)) : made.board;
    };

    /**
     * Takes a card away: a default card is hidden (it comes back through "Karte hinzufügen"), an added one removed. An empty
     * one goes at once; with rows the orga is asked first — the rows go with it, Undo (Ctrl+Z) brings them back.
     */
    const dropCard = async (type: string, count: number) => {
        const isDefault = isDefaultCard(scope, type);
        if (count > 0) {
            const name = t(`raidBoard.assign.type.${type}`);
            if (!(await ask({ title: t(isDefault ? "raidBoard.assign.hideCardTitle" : "raidBoard.assign.removeCardTitle", { type: name }), text: t("raidBoard.assign.removeCardText", { count }), action: t(isDefault ? "raidBoard.assign.hide" : "raidBoard.assign.remove"), tone: "danger" }))) return;
        }
        setExtra(extra.filter((x) => x !== type));
        edit((b) => (isDefault ? hideCard(b, type) : removeCard(b, type)));
    };

    const suggest = async (type: string) => {
        setBusy(type);
        try {
            const r = await suggestRaidplan(csrfToken, { event: isEvent ? eventId : undefined, type, slots: board.slots.map((s) => ({ kind: s.kind, n: s.n, userId: s.userId })), roles: board.roles });
            if (r.assignments.length === 0) toast(t("raidBoard.assign.noSuggestion"));
            else edit((b) => applySuggestions(b, type, r.assignments));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy("");
        }
    };

    const assigneeOptions = (a: RaidplanAssignment): Option[] => {
        const out: Option[] = [];
        for (const s of slots) {
            const ref = `slot:${s.ref}`;
            const r = resolveAssignee(ref, ctx);
            out.push({ key: ref, label: r.player ? `${r.label}: ${r.player.character}` : r.label, on: a.assignees.indexOf(ref) >= 0, group: t(`raidBoard.slot.kind.${s.kind}`), node: <SlotPickChip r={r} n={s.n} /> });
        }
        if (isEvent) {
            const fits = (p: RaidplanPlayer) => (a.preferredClasses && a.preferredClasses.length > 0 ? a.preferredClasses.indexOf(p.classId) >= 0 : fitsType(a.type, p, catalog));
            const fit = playersByClass(roster.filter(fits), a.preferredClasses || []);
            const rest = roster.filter((p) => !fits(p));
            const add = (list: RaidplanPlayer[], group: string) => {
                for (const p of list) {
                    const ref = `user:${p.userId}`;
                    out.push({ key: ref, label: p.character, on: a.assignees.indexOf(ref) >= 0, group, node: <AssignChip r={resolveAssignee(ref, ctx)} /> });
                }
            };
            add(fit, fit.length === roster.length ? t("raidBoard.assign.pickPlayers") : t("raidBoard.assign.pickFitting"));
            add(rest, t("raidBoard.assign.pickOthers"));
        }
        return out;
    };

    /** The spells a row can pick: the catalog's of its type, the ones that fit the assignees' classes first. */
    const spellOptions = (a: RaidplanAssignment): Option[] => {
        const classIds = a.assignees.map((r) => resolveAssignee(r, ctx).player).filter((p) => !!p).map((p) => (p ? p.classId : ""));
        return spellsFor(a.type, catalog, classIds).map((sp) => ({
            key: sp.id, label: sp.name, on: !!a.spell && a.spell.id === sp.id, group: t("raidBoard.assign.pickSpells"),
            node: <span className="rp-achip"><WowIcon name={sp.icon} size={18} /><span>{sp.name}</span></span>,
        }));
    };

    const targetOptions = (a: RaidplanAssignment): Option[] => {
        const out: Option[] = [];
        const has = (tg: RaidplanAssignTarget) => a.targets.some((x) => x.kind === tg.kind && x.ref === tg.ref);
        const push = (tg: RaidplanAssignTarget, group: string) => {
            const r = resolveTarget(tg, ctx);
            const node = tg.kind === "slot" ? <SlotPickChip r={r} n={Number(tg.ref.split(":")[1])} />
                : tg.kind === "group" ? <span className="rp-pchip"><Users size={16} aria-hidden="true" /><b>{tg.ref}</b></span>
                : tg.kind === "mark" ? <span className="rp-pchip"><MarkIcon mark={tg.ref as never} size={22} /></span>
                : <AssignChip r={r} />;
            out.push({ key: `${tg.kind}|${tg.ref}`, label: r.label, on: has(tg), group, node });
        };
        if (MOB_TYPES.indexOf(a.type) >= 0) for (const m of sectionMobs) push(mobTarget(m), t("raidBoard.assign.pickMobs"));
        for (const s of slots) push({ kind: "slot", ref: s.ref }, t(`raidBoard.slot.kind.${s.kind}`));
        for (const g of groups) push({ kind: "group", ref: String(g) }, t("raidBoard.assign.pickGroups"));
        for (const m of ALL_MARKS) push({ kind: "mark", ref: m }, t("raidBoard.assign.pickMarks"));
        if (isEvent) for (const p of roster) push({ kind: "player", ref: p.userId }, t("raidBoard.assign.pickPlayers"));
        return out;
    };

    /** A target chip of the dialog: toggles it on the dialog's copy of the board. */
    const toggleTargetKey = (b: RaidplanBoard, id: string, k: string): RaidplanBoard => {
        const i = k.indexOf("|");
        const kind = k.slice(0, i) as RaidplanAssignTarget["kind"];
        const ref = k.slice(i + 1);
        const mob = kind === "mob" ? sectionMobs.find((m) => m.id === ref) : undefined;
        return toggleTarget(b, id, mob ? mobTarget(mob) : { kind, ref });
    };
    /** The dialog's "Vorschlag": the server picks the assignees for the row's type and classes (rows are not touched until "Fertig"). */
    const suggestAssignees = async (a: RaidplanAssignment): Promise<string[] | null> => {
        try {
            const r = await suggestRaidplan(csrfToken, { event: isEvent ? eventId : undefined, type: a.type, preferredClasses: a.preferredClasses || [], allowOthers: !!a.allowOthers, slots: board.slots.map((s) => ({ kind: s.kind, n: s.n, userId: s.userId })), roles: board.roles });
            if (r.assignments.length === 0) { toast(t("raidBoard.assign.noSuggestion")); return null; }
            return r.assignments[0].assignees;
        } catch (err) {
            toast((err as ApiError).message, "err");
            return null;
        }
    };

    return (
        <section className="rp-assign" aria-label={t("raidBoard.assign.title")}>
            {addAnchor && (
                <Flyout
                    anchor={addAnchor} title={t("raidBoard.assign.addCard")} multi={false} onClose={() => setAddAnchor(null)}
                    options={CARD_ORDER.filter((x) => (SCOPE_TYPES[scope] || SCOPE_TYPES.boss).indexOf(x) >= 0).map((x) => ({ key: x, label: t(`raidBoard.assign.type.${x}`), on: shown.indexOf(x) >= 0, group: t("raidBoard.assign.cardTypes"), node: <TypeBadge type={x} label={t(`raidBoard.assign.type.${x}`)} size={22} /> }))}
                    onToggle={(x) => { if (shown.indexOf(x) >= 0) return; if (board.hiddenCards.indexOf(x) >= 0) edit((b) => showCard(b, x)); else setExtra([...extra, x]); }}
                />
            )}
            {editing && board.assignments.some((x) => x.id === editing) && (
                <AssignModal
                    board={board} rowId={editing} isEvent={isEvent} title={t(`raidBoard.assign.type.${(board.assignments.find((x) => x.id === editing) || { type: "other" }).type}`)}
                    assigneeOptions={assigneeOptions} targetOptions={targetOptions} spellOptions={spellOptions}
                    onTarget={toggleTargetKey}
                    onText={(b, id, text) => (b.assignments.find((x) => x.id === id)?.targets.some((x) => x.kind === "text" && x.ref === text) ? b : toggleTarget(b, id, { kind: "text", ref: text }))}
                    onSpell={(b, id, k) => patchAssignment(b, id, { spell: (b.assignments.find((x) => x.id === id)?.spell || { id: "" }).id === k ? null : spellRefOf(k) })}
                    onSuggest={suggestAssignees}
                    onDone={(row) => { edit((b) => ({ ...b, assignments: b.assignments.map((x) => (x.id === row.id ? { ...row, suggested: false } : x)) })); setEditing(""); }}
                    onClose={() => setEditing("")}
                />
            )}
            <div className="rp-assign-head">
                <h3 className="rp-kicker">{t("raidBoard.assign.title")} · {board.assignments.length}</h3>
                <div className="rp-assign-tools">
                    {canWrite && (
                        <button type="button" className="rp-assign-btn" onClick={onPickProfile} data-tip={t("raidBoard.profile.pick")}>
                            <ScrollText size={15} aria-hidden="true" /><span>{profileName || t("raidBoard.profile.pickShort")}</span>
                        </button>
                    )}
                    {canWrite && scope === "defaults" && onCopyDefaults && (
                        <button type="button" className="rp-assign-btn" data-tip={t("raidBoard.defaults.copyTip")} onClick={onCopyDefaults}><Copy size={15} aria-hidden="true" /><span>{t("raidBoard.defaults.copy")}</span></button>
                    )}
                    {canWrite && addable.length > 0 && (
                        <button type="button" className="rp-assign-btn" aria-haspopup="dialog" onClick={(e) => setAddAnchor(addAnchor ? null : e.currentTarget)}>
                            <Plus size={15} aria-hidden="true" /><span>{t("raidBoard.assign.addCard")}</span>
                        </button>
                    )}
                    {scope !== "general" && board.assignments.some((a) => a.type === "heal") && (
                        <label className="rp-check rp-assign-links"><input type="checkbox" checked={links} onChange={(e) => onLinks(e.target.checked)} /> {t("raidBoard.assign.links")}</label>
                    )}
                </div>
            </div>
            {scope === "defaults" && <p className="rp-muted rp-defaults-explain">{t("raidBoard.defaults.explain")}</p>}
            {shown.length === 0 && <p className="rp-muted rp-assign-empty">{t("raidBoard.assign.emptyRead")}</p>}
            <div className="rp-cards">
                {shown.map((type) => {
                    const rows = rowsOfType(board.assignments, type);
                    const inh = rowsOfType(inherited, type);
                    const fold = folded.indexOf(type) >= 0;
                    return (
                        <section key={type} className="rp-acard" aria-label={t(`raidBoard.assign.type.${type}`)}>
                            <header className="rp-acard-head">
                                <TypeBadge type={type} label={t(`raidBoard.assign.type.${type}`)} size={24} />
                                <span className="rp-acard-count">{rows.length + inh.length}</span>
                                <span className="rp-acard-tools">
                                    {canWrite && defaultRows.length > 0 && canRestore(board, defaultRows, type) && (
                                        <IconButton size="sm" icon={<RotateCcw size={15} />} tip={t("raidBoard.defaults.restore")} onClick={() => edit((b) => restoreInherited(b, defaultRows, type))} />
                                    )}
                                    {canWrite && SUGGESTABLE.indexOf(type) >= 0 && (
                                        <IconButton size="sm" icon={<Wand2 size={15} />} tip={t("raidBoard.assign.suggestOne", { type: t(`raidBoard.assign.type.${type}`) })} disabled={busy === type} onClick={() => suggest(type)} />
                                    )}
                                    {canWrite && <IconButton size="sm" icon={<Plus size={15} />} tip={t("raidBoard.assign.addRowTo", { type: t(`raidBoard.assign.type.${type}`) })} onClick={() => { edit((b) => newRow(b, type)); setFolded(folded.filter((x) => x !== type)); }} />}
                                    {canWrite && <IconButton size="sm" tone="danger" icon={isDefaultCard(scope, type) ? <EyeOff size={15} /> : <Trash2 size={15} />} tip={t(isDefaultCard(scope, type) ? "raidBoard.assign.hideCard" : "raidBoard.assign.removeCard", { type: t(`raidBoard.assign.type.${type}`) })} onClick={() => dropCard(type, rows.length)} />}
                                    <IconButton size="sm" icon={<ChevronDown size={15} className={fold ? "rp-rot-90" : ""} />} tip={t(fold ? "raidBoard.assign.unfold" : "raidBoard.assign.fold")} aria-expanded={!fold} onClick={() => setFolded(fold ? folded.filter((x) => x !== type) : [...folded, type])} />
                                </span>
                            </header>
                            {!fold && (
                                <ul className="rp-alist">
                                    {rows.length === 0 && inh.length === 0 && <li className="rp-muted rp-acard-empty">{t("raidBoard.assign.cardEmpty")}</li>}
                                    {inh.map((a) => (
                                        <li key={`inh-${a.id}`} className="rp-arow is-inherited">
                                            <div className="rp-arow-top">
                                                <span className="rp-inh-mark" data-tip={t("raidBoard.defaults.inheritedTip")}><Link2 size={13} aria-hidden="true" />{t("raidBoard.defaults.inherited")}</span>
                                                {a.title && <span className="rp-atitle-read">{a.title}</span>}
                                                {canWrite && <IconButton size="sm" icon={<Pencil size={14} />} tip={t("raidBoard.defaults.deviate")} onClick={() => { edit((b) => deviate(b, a)); }} />}
                                                {canWrite && <IconButton size="sm" tone="danger" icon={<EyeOff size={14} />} tip={t("raidBoard.defaults.hideRow")} onClick={() => edit((b) => hideInherited(b, a.origin || a.id))} />}
                                            </div>
                                            <div className="rp-arow-main">
                                                <span className="rp-achips">{a.assignees.map((ref) => <AssignChip key={ref} r={resolveAssignee(ref, ctx)} />)}</span>
                                                {a.targets.length > 0 && <span className="rp-aarrow" aria-hidden="true"><ArrowRight size={14} /></span>}
                                                <span className="rp-achips">{a.targets.map((tg) => <AssignChip key={`${tg.kind}|${tg.ref}`} r={resolveTarget(tg, ctx)} />)}</span>
                                            </div>
                                        </li>
                                    ))}
                                    {rows.map((a) => (
                                        <AssignRow
                                            key={a.id} a={a} canWrite={canWrite} ctx={ctx} edit={edit} spellOptions={spellOptions}
                                            noteOpen={noteOpen.indexOf(a.id) >= 0} onNote={() => setNoteOpen([...noteOpen, a.id])} onEdit={setEditing}
                                        />
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>
        </section>
    );
}

/**
 * The read view: the same cards side by side, only those with content, the viewer's own rows
 * highlighted. Names and icons come live from the (approved) setup.
 */
export function AssignTable({ assignments, ctx, me }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[] }) {
    const t = useT();
    if (assignments.length === 0) return null;
    const types = CARD_ORDER.filter((x) => assignments.some((a) => a.type === x));
    return (
        <div className="rp-cards rp-cards-read">
            {types.map((type) => {
                const meta = ASSIGN_META[type] || ASSIGN_META.other;
                return (
                    <section key={type} className="rp-acard" aria-label={t(`raidBoard.assign.type.${type}`)}>
                        <header className="rp-acard-head">
                            <WowIcon name={meta.icon} size={24} />
                            <strong>{t(`raidBoard.assign.type.${type}`)}</strong>
                            <span className="rp-acard-count">{rowsOfType(assignments, type).length}</span>
                        </header>
                        <ul className="rp-alist">
                            {rowsOfType(assignments, type).map((a) => (
                                <li key={a.id} className={`rp-arow${isMine(a, ctx, me) ? " is-own" : ""}`}>
                                    {(a.title || a.spell) && <div className="rp-atitle-read"><WowIcon name={iconForTask(a)} size={20} />{[a.spell ? a.spell.name : "", a.title].filter(Boolean).join(": ")}</div>}
                                    <div className="rp-arow-main">
                                        <span className="rp-achips">
                                            {a.assignees.map((ref, i) => {
                                                const r = resolveAssignee(ref, ctx);
                                                return <AssignChip key={ref} r={r} mine={isMe(r, me)} extra={a.type === "kick" && a.assignees.length > 1 ? <span className="rp-achip-no">{i + 1}</span> : undefined} />;
                                            })}
                                        </span>
                                        {a.targets.length > 0 && <span className="rp-aarrow" aria-hidden="true"><ArrowRight size={14} /></span>}
                                        <span className="rp-achips">
                                            {a.targets.map((tg) => {
                                                const r = resolveTarget(tg, ctx);
                                                return <AssignChip key={`${tg.kind}|${tg.ref}`} r={r} mine={isMe(r, me)} />;
                                            })}
                                        </span>
                                    </div>
                                    {a.note && <span className="rp-muted">{a.note}</span>}
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}
