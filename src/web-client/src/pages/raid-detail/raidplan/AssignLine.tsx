import type { KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, EyeOff, Lock, Pencil, StickyNote, Trash2 } from "lucide-react";
import type { RaidplanAssignment } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ROLE_ICON, classPlaceNameFor, classRefIcon, iconForTask, iconForText, offRole, type AssignCtx, type Resolved } from "../../../lib/assign";
import { assigneeItems, lineLabel, lineState, subLine, targetItems, type LineItem } from "../../../lib/assignLine";
import { groupColor } from "../../../lib/groupStyle";
import { MobIcon } from "./AssignPanel";
import { useT } from "../../../i18n";

/** One chip of a row container: it only shows (no "+", no "x"); a missing place is the one yellow mark, the viewer's own chip carries "DU". */
export function LineChip({ r, open, mine, order, ctx, readOnly, asTank = false }: { r: Resolved; open: boolean; mine: boolean; order: number; ctx: AssignCtx; readOnly?: boolean; asTank?: boolean }) {
    const t = useT();
    const no = order > 0 ? <span className="rp-achip-no">{order}</span> : null;
    if (r.player) {
        // a player outside his spec role on a tanking row (a mage tank) says so: class name in the tooltip, "als Tank" beside the name
        return <span className={`rp-lc${mine && readOnly ? " is-me" : ""}`} data-tip={asTank ? `${t(`wow.class.${r.player.classId}`)} · ${t("raidBoard.class.asTank")}` : undefined}>{no}<TokenIcon player={r.player} size="sm" /><PlayerName player={r.player} />{asTank && <span className="rp-lc-as">{t("raidBoard.class.asTank")}</span>}{mine && readOnly && <span className="rp-lc-du">{t("raidBoard.public.du")}</span>}</span>;
    }
    if (r.kind === "class") return <span className={`rp-lc ${open ? "is-open" : "is-slot"}`}>{no}<WowIcon name={r.icon} size={16} /><span>{open ? t("raidBoard.aline.missing", { what: r.label }) : r.label}</span>{open && <AlertTriangle size={12} aria-hidden="true" />}</span>;
    if (r.kind === "slot") return <span className={`rp-lc ${open ? "is-open" : "is-slot"}`}>{no}<WowIcon name={ROLE_ICON[r.role] || ROLE_ICON.dps} size={16} /><span>{r.label}</span>{open && <AlertTriangle size={12} aria-label={t("raidBoard.slot.open")} />}</span>;
    if (r.kind === "group") return <span className="rp-lc is-grp" style={{ borderLeftColor: groupColor(ctx.groupColors, r.group) }}><span>{r.label}</span></span>;
    if (r.kind === "mob") return <span className="rp-lc is-mk"><MobIcon icon={r.icon} size={18} /><span>{r.label}</span></span>;
    if (r.kind === "mark") return <span className="rp-lc is-mk"><MarkIcon mark={r.mark as never} size={16} /><span>{r.label}</span></span>;
    if (r.kind === "text") return <span className="rp-lc is-mk"><WowIcon name={iconForText(r.label) || "inv_misc_note_01"} size={16} /><span>{r.label}</span></span>;
    return <span className="rp-lc is-slot">{no}<span>{r.label}</span></span>;
}

function Cell({ items, ctx, readOnly, side, type }: { items: LineItem[]; ctx: AssignCtx; readOnly?: boolean; side: string; type: string }) {
    const t = useT();
    return (
        <div className={`rp-line-cell is-${side}`} aria-label={t(side === "who" ? "raidBoard.aline.colWho" : "raidBoard.aline.colAt")} role="group">
            {items.map((x) => (x.kind === "ref" ? (
                <span key={x.key} className="rp-lref">
                    <span className="rp-lref-t"><WowIcon name={classRefIcon(x.classId, x.role)} size={13} />{classPlaceNameFor(x.classId, x.role, type)} x{x.count}</span>
                    {x.items.map((r, i) => <LineChip key={`${r.ref}${i}`} r={r} open={r.open && (r.kind === "class" || r.kind === "slot")} mine={!!r.player && x.mine} order={0} ctx={ctx} readOnly={readOnly} asTank={offRole(type, r.player)} />)}
                </span>
            ) : x.r ? <LineChip key={x.key} r={x.r} open={x.open} mine={x.mine} order={x.order} ctx={ctx} readOnly={readOnly} asTank={x.asTank} /> : null))}
        </div>
    );
}

/**
 * One assignment row as ONE container (option 1 of "Zeile mit Chip-Container"): spell icon | who | arrow | at whom | actions, the same columns
 * in every row of a card. The chips only show; the whole row is one button (the pencil's click area fills the container) that opens the row
 * dialog; note and delete sit above it. Tab reaches the row, Enter opens, Delete removes (after asking). A small line under it only when
 * there is a spell, a task text or a note. `readOnly` (the sheet): no actions, the viewer's own chip carries "DU" and frames the row.
 * `inherited` (a row from the template's Standard): a lock instead of the trash, the pencil makes it the section's own.
 */
export default function AssignLine({ a, filled, ctx, isEvent, readOnly, inherited, me = [], onOpen, onNote, onDelete, onHide }: {
    a: RaidplanAssignment;
    /** the row with its class references resolved (same order) */
    filled: RaidplanAssignment;
    ctx: AssignCtx;
    isEvent: boolean;
    readOnly?: boolean;
    inherited?: boolean;
    me?: string[];
    onOpen?: () => void;
    onNote?: () => void;
    /** `ask` = the Delete key (asks first); the trash removes at once (Ctrl+Z brings it back) */
    onDelete?: (ask: boolean) => void;
    onHide?: () => void;
}) {
    const t = useT();
    const typeName = t(`raidBoard.assign.type.${a.type}`);
    const who = assigneeItems(a, filled, ctx, me, a.type === "kick" && a.assignees.length > 1, isEvent);
    const at = targetItems(a, filled, ctx, me, isEvent);
    const state = lineState(a, filled, ctx, isEvent);
    const sub = subLine(a);
    const mineRow = !!readOnly && [...who, ...at].some((x) => x.mine);
    const icon = a.spell && a.spell.icon ? a.spell.icon : iconForTask(a);
    const label = lineLabel(typeName, who, at, t("raidBoard.amb.openSlot"));
    const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
        if ((e.key === "Delete" || e.key === "Backspace") && onDelete && !inherited && (e.target as HTMLElement).classList.contains("rp-line-open")) { e.preventDefault(); onDelete(true); }
    };
    const cls = ["rp-line", state === "empty" ? "is-blank" : `is-${state}`, readOnly ? "is-ro" : "", inherited ? "is-lock" : "", mineRow ? "is-me" : "", a.suggested ? "is-suggested" : ""].filter(Boolean).join(" ");
    return (
        <li className={cls} onKeyDown={onKey}>
            <span className="rp-line-ico" data-tip={a.spell ? a.spell.name : typeName}><WowIcon name={icon} size={24} /></span>
            {state === "empty" ? (
                <span className="rp-line-empty">{t("raidBoard.aline.pickWho")}<ArrowRight size={15} aria-hidden="true" />{t("raidBoard.aline.pickTarget")}</span>
            ) : (
                <>
                    <Cell items={who} ctx={ctx} readOnly={readOnly} side="who" type={a.type} />
                    {at.length > 0 ? <ArrowRight className="rp-line-arr" size={16} aria-hidden="true" /> : <span className="rp-line-arr" aria-hidden="true" />}
                    <Cell items={at} ctx={ctx} readOnly={readOnly} side="at" type={a.type} />
                </>
            )}
            {!readOnly && (
                <div className="rp-line-acts">
                    {onOpen && <button type="button" className="rp-line-open rp-line-btn" aria-label={`${t(inherited ? "raidBoard.defaults.deviate" : "raidBoard.aline.edit")}: ${label}`} data-tip={t(inherited ? "raidBoard.defaults.deviate" : "raidBoard.aline.edit")} onClick={onOpen}><Pencil size={14} /></button>}
                    {inherited ? (
                        <>
                            {onHide && <button type="button" className="rp-line-btn" aria-label={t("raidBoard.defaults.hideRow")} data-tip={t("raidBoard.defaults.hideRow")} onClick={onHide}><EyeOff size={14} /></button>}
                            <span className="rp-line-btn is-fixed" role="img" aria-label={t("raidBoard.defaults.inheritedTip")} data-tip={t("raidBoard.defaults.inheritedTip")}><Lock size={14} /></span>
                        </>
                    ) : (
                        <>
                            {onNote && <button type="button" className={`rp-line-btn${a.note ? " is-on" : ""}`} aria-label={t("raidBoard.assign.addNote")} data-tip={a.note || t("raidBoard.assign.addNote")} onClick={onNote}><StickyNote size={14} /></button>}
                            {onDelete && <button type="button" className="rp-line-btn is-danger" aria-label={t("raidBoard.assign.delete")} data-tip={t("raidBoard.assign.delete")} onClick={() => onDelete(false)}><Trash2 size={14} /></button>}
                        </>
                    )}
                </div>
            )}
            {(sub.length > 0 || inherited) && (
                <div className="rp-line-sub" data-tip={sub.join(" · ") || undefined}>
                    {inherited && <span className="rp-line-std">{t("raidBoard.defaults.inherited")}</span>}
                    {sub.map((s, i) => <span key={i} className={i === 0 && a.spell ? "rp-line-sp" : ""}>{s}</span>)}
                </div>
            )}
        </li>
    );
}
