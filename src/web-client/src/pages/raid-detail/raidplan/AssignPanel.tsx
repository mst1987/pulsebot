import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Wand2, X } from "lucide-react";
import { suggestRaidplan, type ApiError, type RaidplanAssignment, type RaidplanAssignTarget, type RaidplanBoard, type RaidplanPlayer } from "../../../api";
import { Badge, IconButton } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { useToast } from "../../../components/Jobs";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import {
    ALL_MARKS, ASSIGN_META, SUGGESTABLE, addAssignment, applySuggestions, assignTypes, fitsType, isMine, moveAssignee, patchAssignment, removeAssignment,
    resolveAssignee, resolveTarget, slotChoices, toggleAssignee, toggleTarget, type AssignCtx, type Resolved,
} from "../../../lib/assign";
import { useT } from "../../../i18n";

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
    ) : (
        <span className={r.open && r.kind !== "text" ? "rp-achip-open" : ""}>{r.label}{r.open && r.kind === "slot" ? ` (${t("raidBoard.slot.open")})` : ""}</span>
    );
    return (
        <span className={`rp-achip rp-achip-${r.kind}${mine ? " is-own" : ""}`}>
            {extra}{body}
            {onRemove && <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={onRemove}><X size={12} /></button>}
        </span>
    );
}

type Option = { key: string; label: string; node: ReactNode; on: boolean; group: string };

/** A "+" that opens a small list to tick from (several at once); closes on a click outside or Esc. */
function ChipPicker({ options, onToggle, textPlaceholder, onText, label }: {
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

/**
 * "Einteilungen": compact rows right under the board — who does what (healers to tanks
 * and groups, kicks in order, misdirects, curses, trash tanks to marks ...). Assignees and
 * targets are chips picked from a small list (several at once); a suggestion button fills
 * rows from the setup and marks them "Vorschlag" until somebody edits them.
 */
export default function AssignPanel({ scope, board, edit, roster, players, isEvent, canWrite, eventId, csrfToken, groupCount, links, onLinks }: {
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
}) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const ctx: AssignCtx = useMemo(() => ({ slots: board.slots, players }), [board.slots, players]);
    const types = assignTypes(scope);
    const suggestable = types.filter((x) => SUGGESTABLE.indexOf(x) >= 0);
    const slots = useMemo(() => slotChoices(board.slots), [board.slots]);
    const groups = Array.from({ length: Math.max(1, groupCount) }, (_, i) => i + 1);

    const suggest = async (type: string) => {
        if (!type) return;
        setBusy(true);
        try {
            const r = await suggestRaidplan(csrfToken, { event: isEvent ? eventId : undefined, type, slots: board.slots.map((s) => ({ kind: s.kind, n: s.n, userId: s.userId })) });
            if (r.assignments.length === 0) toast(t("raidBoard.assign.noSuggestion"));
            else edit((b) => applySuggestions(b, type, r.assignments));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
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
            const fit = roster.filter((p) => fitsType(a.type, p));
            const rest = roster.filter((p) => !fitsType(a.type, p));
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

    const targetOptions = (a: RaidplanAssignment): Option[] => {
        const out: Option[] = [];
        const has = (tg: RaidplanAssignTarget) => a.targets.some((x) => x.kind === tg.kind && x.ref === tg.ref);
        const push = (tg: RaidplanAssignTarget, group: string) => {
            const r = resolveTarget(tg, ctx);
            out.push({ key: `${tg.kind}|${tg.ref}`, label: r.label, on: has(tg), group, node: <AssignChip r={r} /> });
        };
        for (const s of slots) push({ kind: "slot", ref: s.ref }, t("raidBoard.assign.pickSlots"));
        for (const g of groups) push({ kind: "group", ref: String(g) }, t("raidBoard.assign.pickGroups"));
        for (const m of ALL_MARKS) push({ kind: "mark", ref: m }, t("raidBoard.assign.pickMarks"));
        if (isEvent) for (const p of roster) push({ kind: "player", ref: p.userId }, t("raidBoard.assign.pickPlayers"));
        return out;
    };

    const rows = board.assignments;
    return (
        <section className="rp-assign" aria-label={t("raidBoard.assign.title")}>
            <div className="rp-assign-head">
                <h3 className="rp-kicker">{t("raidBoard.assign.title")} · {rows.length}</h3>
                {canWrite && (
                    <div className="rp-assign-tools">
                        {suggestable.length > 0 && (
                            <label className="rp-assign-sel" data-tip={t("raidBoard.assign.suggestTip")}>
                                <Wand2 size={15} aria-hidden="true" />
                                <select value="" disabled={busy} aria-label={t("raidBoard.assign.suggest")} onChange={(e) => suggest(e.target.value)}>
                                    <option value="">{t("raidBoard.assign.suggest")}</option>
                                    {suggestable.map((x) => <option key={x} value={x}>{t(`raidBoard.assign.suggestType.${x}`)}</option>)}
                                </select>
                            </label>
                        )}
                        <label className="rp-assign-sel">
                            <Plus size={15} aria-hidden="true" />
                            <select
                                value="" aria-label={t("raidBoard.assign.add")}
                                onChange={(e) => { if (e.target.value) edit((b) => addAssignment(b, e.target.value).board); }}
                            >
                                <option value="">{t("raidBoard.assign.add")}</option>
                                {types.map((x) => <option key={x} value={x}>{t(`raidBoard.assign.type.${x}`)}</option>)}
                            </select>
                        </label>
                    </div>
                )}
                {scope !== "general" && rows.some((a) => a.type === "heal") && (
                    <label className="rp-check rp-assign-links"><input type="checkbox" checked={links} onChange={(e) => onLinks(e.target.checked)} /> {t("raidBoard.assign.links")}</label>
                )}
            </div>
            {rows.length === 0 && <p className="rp-muted rp-assign-empty">{t(canWrite ? "raidBoard.assign.empty" : "raidBoard.assign.emptyRead")}</p>}
            <ul className="rp-alist">
                {rows.map((a) => {
                    const meta = ASSIGN_META[a.type] || ASSIGN_META.other;
                    const rotation = a.type === "kick" && a.assignees.length > 1;
                    return (
                        <li key={a.id} className={`rp-arow${a.suggested ? " is-suggested" : ""}`}>
                            <span className="rp-atype" data-tip={t(`raidBoard.assign.type.${a.type}`)}>
                                <WowIcon name={meta.icon} size={22} />
                                <span>{t(`raidBoard.assign.type.${a.type}`)}</span>
                                {a.suggested && <Badge tone="mid">{t("raidBoard.assign.suggested")}</Badge>}
                            </span>
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
                            <span className="rp-aarrow" aria-hidden="true">→</span>
                            <span className="rp-achips" role="group" aria-label={t("raidBoard.assign.targets")}>
                                {a.targets.map((tg) => (
                                    <AssignChip key={`${tg.kind}|${tg.ref}`} r={resolveTarget(tg, ctx)} onRemove={canWrite ? () => edit((b) => toggleTarget(b, a.id, tg)) : undefined} />
                                ))}
                                {canWrite && (
                                    <ChipPicker
                                        label={t("raidBoard.assign.addTarget")} options={targetOptions(a)}
                                        onToggle={(k) => { const i = k.indexOf("|"); edit((b) => toggleTarget(b, a.id, { kind: k.slice(0, i) as RaidplanAssignTarget["kind"], ref: k.slice(i + 1) })); }}
                                        textPlaceholder={t("raidBoard.assign.textTarget")}
                                        onText={(text) => edit((b) => (a.targets.some((x) => x.kind === "text" && x.ref === text) ? b : toggleTarget(b, a.id, { kind: "text", ref: text })))}
                                    />
                                )}
                            </span>
                            {canWrite ? (
                                <input
                                    className="rp-anote" value={a.note} maxLength={200} placeholder={t("raidBoard.assign.note")} aria-label={t("raidBoard.assign.note")}
                                    onChange={(e) => edit((b) => patchAssignment(b, a.id, { note: e.target.value }))}
                                />
                            ) : a.note ? <span className="rp-muted">{a.note}</span> : null}
                            {canWrite && <IconButton size="sm" tone="danger" icon={<Trash2 size={15} />} tip={t("raidBoard.assign.delete")} onClick={() => edit((b) => removeAssignment(b, a.id))} />}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/**
 * The read view's table for one boss: "who heals whom" and the rest, grouped by type, the
 * viewer's own rows highlighted. Names and icons come live from the (approved) setup.
 */
export function AssignTable({ assignments, ctx, me }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string }) {
    const t = useT();
    if (assignments.length === 0) return null;
    return (
        <table className="rp-atable">
            <caption className="rp-kicker">{t("raidBoard.assign.title")}</caption>
            <tbody>
                {assignments.map((a) => {
                    const meta = ASSIGN_META[a.type] || ASSIGN_META.other;
                    const mine = isMine(a, ctx, me);
                    return (
                        <tr key={a.id} className={mine ? "is-own" : ""}>
                            <th scope="row"><span className="rp-atype"><WowIcon name={meta.icon} size={20} />{t(`raidBoard.assign.type.${a.type}`)}</span></th>
                            <td>
                                <span className="rp-achips">
                                    {a.assignees.map((ref, i) => {
                                        const r = resolveAssignee(ref, ctx);
                                        return <AssignChip key={ref} r={r} mine={!!me && !!r.player && r.player.userId === me} extra={a.type === "kick" && a.assignees.length > 1 ? <span className="rp-achip-no">{i + 1}</span> : undefined} />;
                                    })}
                                </span>
                            </td>
                            <td className="rp-aarrow" aria-hidden="true">→</td>
                            <td>
                                <span className="rp-achips">
                                    {a.targets.map((tg) => {
                                        const r = resolveTarget(tg, ctx);
                                        return <AssignChip key={`${tg.kind}|${tg.ref}`} r={r} mine={!!me && !!r.player && r.player.userId === me} />;
                                    })}
                                </span>
                            </td>
                            <td className="rp-muted">{a.note}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
