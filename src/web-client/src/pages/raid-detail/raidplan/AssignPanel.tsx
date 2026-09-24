import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Swords, ChevronDown, LayoutGrid, Users, ChevronLeft, ChevronRight, Plus, ScrollText, StickyNote, Trash2, Wand2, X } from "lucide-react";
import { suggestRaidplan, type ApiError, type RaidplanAssignment, type Catalog, type RaidplanAssignTarget, type RaidplanBoard, type RaidplanMobRef, type RaidplanSpellRef, type RaidplanPlayer } from "../../../api";
import { Badge, IconButton } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { useToast } from "../../../components/Jobs";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import {
    ALL_MARKS, CARD_ORDER, ASSIGN_META, mobTarget, spellRef, spellsFor, ROLE_ICON, iconForTask, iconForText, isMe, myTasks, tasksByAssignee, SUGGESTABLE, addRowOfType, addableCards, applySuggestions, cardTypes, fitsType, isMine, rowsOfType, moveAssignee, patchAssignment, removeAssignment,
    resolveAssignee, resolveTarget, slotChoices, toggleAssignee, toggleTarget, type AssignCtx, type Resolved,
} from "../../../lib/assign";
import { wowIconUrl } from "../../../lib/wowIcon";
import { useT } from "../../../i18n";

/** A mob's icon: a boss image (boss:N), a WoW icon by name, or the generic enemy symbol. */
export function MobIcon({ icon, size = 18 }: { icon: string; size?: number }) {
    if (icon.indexOf("boss:") === 0) return <img className="rp-mobicon" src={`/bosses/${icon.slice(5)}.jpg`} alt="" width={size} height={size} draggable={false} />;
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

/** A "+" that opens a small list to tick from (several at once); closes on a click outside or Esc. */
export function ChipPicker({ options, onToggle, textPlaceholder, onText, label }: {
    options: Option[];
    onToggle: (key: string) => void;
    textPlaceholder?: string;
    onText?: (text: string) => void;
    label: string;
}) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", away, true);
        document.addEventListener("keydown", key);
        return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
    }, [open]);
    const groups = [...new Set(options.map((o) => o.group))];
    return (
        <span className="rp-picker" ref={ref}>
            <button type="button" className="rp-achip rp-achip-add" aria-label={label} aria-expanded={open} data-tip={label} onClick={() => setOpen((v) => !v)}><Plus size={14} /></button>
            {open && (
                <div className="rp-pop" role="listbox" aria-label={label} aria-multiselectable="true">
                    {groups.map((g) => (
                        <div key={g} className="rp-pop-group">
                            {g && <span className="rp-kicker">{g}</span>}
                            {options.filter((o) => o.group === g).map((o) => (
                                <button key={o.key} type="button" role="option" aria-selected={o.on} className={`rp-pop-item${o.on ? " is-on" : ""}`} onClick={() => onToggle(o.key)}>
                                    {o.node}
                                </button>
                            ))}
                        </div>
                    ))}
                    {onText && (
                        <form className="rp-pop-text" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onText(text.trim()); setText(""); } }}>
                            <input value={text} maxLength={60} placeholder={textPlaceholder} aria-label={textPlaceholder} onChange={(e) => setText(e.target.value)} />
                            <button type="submit" className="rp-achip rp-achip-add" aria-label={textPlaceholder} disabled={!text.trim()}><Plus size={14} /></button>
                        </form>
                    )}
                </div>
            )}
        </span>
    );
}

/** One row inside a card: two compact lines — the task and its buttons, then who -> what. */
const SPELL_TYPES = ["curse", "thunderclap", "demoshout", "md", "ss", "fearward", "kick", "dispel", "cc", "buff", "tank"];
const MOB_TYPES = ["tank", "trashtank", "special", "cc", "kick", "dispel", "other"];

function AssignRow({ a, canWrite, ctx, edit, assigneeOptions, targetOptions, spellOptions, spellRefOf, sectionMobs, noteOpen, onNote }: {
    a: RaidplanAssignment;
    canWrite: boolean;
    ctx: AssignCtx;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    assigneeOptions: (a: RaidplanAssignment) => Option[];
    targetOptions: (a: RaidplanAssignment) => Option[];
    spellOptions: (a: RaidplanAssignment) => Option[];
    spellRefOf: (id: string) => RaidplanSpellRef | null;
    sectionMobs: RaidplanMobRef[];
    noteOpen: boolean;
    onNote: () => void;
}) {
    const t = useT();
    const rotation = a.type === "kick" && a.assignees.length > 1;
    const showNote = a.note !== "" || noteOpen;
    return (
        <li className={`rp-arow${a.suggested ? " is-suggested" : ""}`}>
            <div className="rp-arow-top">
                <WowIcon name={iconForTask(a)} size={22} />
                {SPELL_TYPES.indexOf(a.type) >= 0 && (a.spell ? (
                    <span className="rp-achip rp-spellchip" data-tip={a.spell.name}>
                        <WowIcon name={a.spell.icon || iconForTask({ ...a, spell: null })} size={18} /><span>{a.spell.name}</span>
                        {canWrite && <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={() => edit((b) => patchAssignment(b, a.id, { spell: null }))}><X size={12} /></button>}
                    </span>
                ) : canWrite && spellOptions(a).length > 0 && (
                    <ChipPicker label={t("raidBoard.assign.pickSpell")} options={spellOptions(a)} onToggle={(k) => edit((b) => patchAssignment(b, a.id, { spell: spellOptions(a).length ? spellRefOf(k) : null }))} />
                ))}
                {canWrite ? (
                    <input
                        className="rp-atitle" value={a.title} maxLength={80} placeholder={t(`raidBoard.assign.type.${a.type}`)} aria-label={t("raidBoard.assign.task")}
                        onChange={(e) => edit((b) => patchAssignment(b, a.id, { title: e.target.value }))}
                    />
                ) : <span className="rp-atitle-read">{a.title || t(`raidBoard.assign.type.${a.type}`)}</span>}
                {a.suggested && <Badge tone="mid">{t("raidBoard.assign.suggested")}</Badge>}
                {canWrite && !showNote && <IconButton size="sm" icon={<StickyNote size={14} />} tip={t("raidBoard.assign.addNote")} onClick={onNote} />}
                {canWrite && <IconButton size="sm" tone="danger" icon={<Trash2 size={14} />} tip={t("raidBoard.assign.delete")} onClick={() => edit((b) => removeAssignment(b, a.id))} />}
            </div>
            <div className="rp-arow-main">
                <span className="rp-achips" role="group" aria-label={t("raidBoard.assign.assignees")}>
                    {a.assignees.map((ref, i) => (
                        <AssignChip
                            key={ref} r={resolveAssignee(ref, ctx)}
                            extra={rotation ? <span className="rp-achip-no">{i + 1}</span> : undefined}
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
                    {canWrite && <ChipPicker label={t("raidBoard.assign.addAssignee")} options={assigneeOptions(a)} onToggle={(k) => edit((b) => toggleAssignee(b, a.id, k))} />}
                </span>
                <span className="rp-aarrow" aria-hidden="true"><ArrowRight size={14} /></span>
                <span className="rp-achips" role="group" aria-label={t("raidBoard.assign.targets")}>
                    {a.targets.map((tg) => (
                        <AssignChip key={`${tg.kind}|${tg.ref}`} r={resolveTarget(tg, ctx)} onRemove={canWrite ? () => edit((b) => toggleTarget(b, a.id, tg)) : undefined} />
                    ))}
                    {canWrite && (
                        <ChipPicker
                            label={t("raidBoard.assign.addTarget")} options={targetOptions(a)}
                            onToggle={(k) => { const i = k.indexOf("|"); const kind = k.slice(0, i) as RaidplanAssignTarget["kind"]; const ref = k.slice(i + 1); const mob = kind === "mob" ? sectionMobs.find((m) => m.id === ref) : undefined; edit((b) => toggleTarget(b, a.id, mob ? mobTarget(mob) : { kind, ref })); }}
                            textPlaceholder={t("raidBoard.assign.textTarget")}
                            onText={(text) => edit((b) => (a.targets.some((x) => x.kind === "text" && x.ref === text) ? b : toggleTarget(b, a.id, { kind: "text", ref: text })))}
                        />
                    )}
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
export default function AssignPanel({ scope, board, edit, roster, players, isEvent, canWrite, eventId, csrfToken, groupCount, links, onLinks, profileName, onPickProfile, catalog, sectionMobs }: {
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
}) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState("");
    const [noteOpen, setNoteOpen] = useState<string[]>([]);
    const [extra, setExtra] = useState<string[]>([]);
    const [folded, setFolded] = useState<string[]>([]);
    const [view, setView] = useState<"cards" | "players">("cards");
    const ctx: AssignCtx = useMemo(() => ({ slots: board.slots, players, catalog }), [board.slots, players, catalog]);
    const slots = useMemo(() => slotChoices(board.slots), [board.slots]);
    const spellRefOf = (id: string) => { const sp = (catalog ? catalog.spells : []).find((x) => x.id === id); return sp ? spellRef(sp) : null; };
    const groups = Array.from({ length: Math.max(1, groupCount) }, (_, i) => i + 1);
    // another boss brings its own hand-added cards
    useEffect(() => { setExtra([]); setFolded([]); }, [scope, eventId]);

    const shown = cardTypes(scope, board.assignments, extra, !canWrite);
    const addable = addableCards(scope, shown);

    /** A new row of a card's type; a tanking row of a boss starts with the boss as its target. */
    const newRow = (b: RaidplanBoard, type: string): RaidplanBoard => {
        const made = addRowOfType(b, type);
        const boss = scope === "boss" && type === "tank" ? sectionMobs.find((m) => m.id.indexOf("b:") === 0) : undefined;
        return boss ? toggleTarget(made.board, made.id, mobTarget(boss)) : made.board;
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
        const slotTitle = t("raidBoard.assign.pickSlots");
        for (const s of slots) {
            const ref = `slot:${s.ref}`;
            const r = resolveAssignee(ref, ctx);
            out.push({ key: ref, label: r.label, on: a.assignees.indexOf(ref) >= 0, group: slotTitle, node: <AssignChip r={r} /> });
        }
        if (isEvent) {
            const fit = roster.filter((p) => fitsType(a.type, p, catalog));
            const rest = roster.filter((p) => !fitsType(a.type, p, catalog));
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
            out.push({ key: `${tg.kind}|${tg.ref}`, label: r.label, on: has(tg), group, node: <AssignChip r={r} /> });
        };
        if (MOB_TYPES.indexOf(a.type) >= 0) for (const m of sectionMobs) push(mobTarget(m), t("raidBoard.assign.pickMobs"));
        for (const s of slots) push({ kind: "slot", ref: s.ref }, t("raidBoard.assign.pickSlots"));
        for (const g of groups) push({ kind: "group", ref: String(g) }, t("raidBoard.assign.pickGroups"));
        for (const m of ALL_MARKS) push({ kind: "mark", ref: m }, t("raidBoard.assign.pickMarks"));
        if (isEvent) for (const p of roster) push({ kind: "player", ref: p.userId }, t("raidBoard.assign.pickPlayers"));
        return out;
    };

    return (
        <section className="rp-assign" aria-label={t("raidBoard.assign.title")}>
            <div className="rp-assign-head">
                <h3 className="rp-kicker">{t("raidBoard.assign.title")} · {board.assignments.length}</h3>
                <div className="rp-assign-tools">
                    {canWrite && (
                        <button type="button" className="rp-assign-btn" onClick={onPickProfile} data-tip={t("raidBoard.profile.pick")}>
                            <ScrollText size={15} aria-hidden="true" /><span>{profileName || t("raidBoard.profile.pickShort")}</span>
                        </button>
                    )}
                    {canWrite && addable.length > 0 && (
                        <label className="rp-assign-sel">
                            <Plus size={15} aria-hidden="true" />
                            <select value="" aria-label={t("raidBoard.assign.addCard")} onChange={(e) => { const v = e.target.value; if (v) setExtra([...extra, v]); }}>
                                <option value="">{t("raidBoard.assign.addCard")}</option>
                                {addable.map((x) => <option key={x} value={x}>{t(`raidBoard.assign.type.${x}`)}</option>)}
                            </select>
                        </label>
                    )}
                    <span className="rp-seg" role="group" aria-label={t("raidBoard.assign.view")}>
                        <button type="button" className={view === "cards" ? "is-on" : ""} aria-pressed={view === "cards"} data-tip={t("raidBoard.assign.viewCards")} onClick={() => setView("cards")}><LayoutGrid size={15} /></button>
                        <button type="button" className={view === "players" ? "is-on" : ""} aria-pressed={view === "players"} data-tip={t("raidBoard.assign.viewPlayers")} onClick={() => setView("players")}><Users size={15} /></button>
                    </span>
                    {scope !== "general" && board.assignments.some((a) => a.type === "heal") && (
                        <label className="rp-check rp-assign-links"><input type="checkbox" checked={links} onChange={(e) => onLinks(e.target.checked)} /> {t("raidBoard.assign.links")}</label>
                    )}
                </div>
            </div>
            {shown.length === 0 && <p className="rp-muted rp-assign-empty">{t("raidBoard.assign.emptyRead")}</p>}
            {view === "players" && <PlayerTasksList assignments={board.assignments} ctx={ctx} me={[]} yours={false} />}
            {view === "cards" && <div className="rp-cards">
                {shown.map((type) => {
                    const rows = rowsOfType(board.assignments, type);
                    const meta = ASSIGN_META[type] || ASSIGN_META.other;
                    const fold = folded.indexOf(type) >= 0;
                    return (
                        <section key={type} className="rp-acard" aria-label={t(`raidBoard.assign.type.${type}`)}>
                            <header className="rp-acard-head">
                                <WowIcon name={meta.icon} size={24} />
                                <strong>{t(`raidBoard.assign.type.${type}`)}</strong>
                                <span className="rp-acard-count">{rows.length}</span>
                                <span className="rp-acard-tools">
                                    {canWrite && SUGGESTABLE.indexOf(type) >= 0 && (
                                        <IconButton size="sm" icon={<Wand2 size={15} />} tip={t("raidBoard.assign.suggestOne", { type: t(`raidBoard.assign.type.${type}`) })} disabled={busy === type} onClick={() => suggest(type)} />
                                    )}
                                    {canWrite && <IconButton size="sm" icon={<Plus size={15} />} tip={t("raidBoard.assign.addRowTo", { type: t(`raidBoard.assign.type.${type}`) })} onClick={() => { edit((b) => newRow(b, type)); setFolded(folded.filter((x) => x !== type)); }} />}
                                    <IconButton size="sm" icon={<ChevronDown size={15} className={fold ? "rp-rot-90" : ""} />} tip={t(fold ? "raidBoard.assign.unfold" : "raidBoard.assign.fold")} aria-expanded={!fold} onClick={() => setFolded(fold ? folded.filter((x) => x !== type) : [...folded, type])} />
                                </span>
                            </header>
                            {!fold && (
                                <ul className="rp-alist">
                                    {rows.length === 0 && <li className="rp-muted rp-acard-empty">{t("raidBoard.assign.cardEmpty")}</li>}
                                    {rows.map((a) => (
                                        <AssignRow
                                            key={a.id} a={a} canWrite={canWrite} ctx={ctx} edit={edit} assigneeOptions={assigneeOptions} targetOptions={targetOptions} spellOptions={spellOptions} spellRefOf={spellRefOf} sectionMobs={sectionMobs}
                                            noteOpen={noteOpen.indexOf(a.id) >= 0} onNote={() => setNoteOpen([...noteOpen, a.id])}
                                        />
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>}
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

/**
 * The tasks of a section per person, derived from the assignments (nothing to maintain): first "your
 * tasks" as short lines with icons (for a visitor whose player was recognised), then one line per
 * player — the player, then their tasks as icon chips. Players without a task are not listed. In a
 * template the "player" is the slot ("Heiler 1").
 */
export function PlayerTasksList({ assignments, ctx, me, yours }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[]; yours: boolean }) {
    const t = useT();
    const mine = yours ? myTasks(assignments, ctx, me) : [];
    const all = tasksByAssignee(assignments, ctx);
    if (all.length === 0) return null;
    return (
        <div className="rp-tasks">
            {mine.length > 0 && (
                <section className="rp-mytasks" aria-label={t("raidBoard.assign.yourTasks")}>
                    <h3 className="rp-kicker">{t("raidBoard.assign.yourTasks")}</h3>
                    <ul>
                        {mine.map((k) => <li key={k.id}><WowIcon name={k.icon} size={26} /><span>{k.text}</span></li>)}
                    </ul>
                </section>
            )}
            <section className="rp-bytasks" aria-label={t("raidBoard.assign.byPlayer")}>
                <h3 className="rp-kicker">{t("raidBoard.assign.byPlayer")}</h3>
                <ul>
                    {all.map((row) => (
                        <li key={row.key} className={isMe(row.who, me) ? "is-own" : ""}>
                            <AssignChip r={row.who} mine={isMe(row.who, me)} />
                            <span className="rp-achips">
                                {row.tasks.map((k) => (
                                    <span key={k.id} className="rp-taskchip" data-tip={k.text}><WowIcon name={k.icon} size={20} /><span>{k.text}</span></span>
                                ))}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}
