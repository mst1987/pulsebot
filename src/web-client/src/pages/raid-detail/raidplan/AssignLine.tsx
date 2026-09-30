import { ANY } from "../../../lib/raidplan/classRefs";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, EyeOff, Lock, MapPin, MoreHorizontal, Pencil, StickyNote, Trash2 } from "lucide-react";
import Popover from "../../../components/ui/Popover";
import { belowEndPlacement } from "../../../lib/popoverPosition";
import { CLASS_COLOR } from "../../../lib/raidplan/classRefs";
import type { RaidplanAssignment } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import ClassRefIcon from "../../../components/raidplan/ClassRefIcon";
import RoleGlyph from "../../../components/raidplan/RoleGlyph";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon, playerLabel } from "../../../components/raidplan/PlanBoard";
import { classIconOf, classPlaceNameFor, iconForTask, iconForText, offRole, type AssignCtx, type Resolved } from "../../../lib/raidplan/assign";
import { assigneeItems, lineLabel, lineState, subLine, targetItems, type LineItem } from "../../../lib/raidplan/assignLine";
import { groupColor } from "../../../lib/raidplan/groupStyle";
import { MobIcon } from "./AssignPanel";
import { ROLE_TONE } from "../../../lib/raidplan/assign";
import { useT } from "../../../i18n";

/** One chip of a row container: it only shows (no "+", no "x"); a missing place is the one yellow mark, the viewer's own chip carries "DU". */
export function LineChip({ r, open, mine, order, ctx, readOnly, asTank = false }: { r: Resolved; open: boolean; mine: boolean; order: number; ctx: AssignCtx; readOnly?: boolean; asTank?: boolean }) {
    const t = useT();
    const no = order > 0 ? <span className="rp-achip-no">{order}</span> : null;
    if (r.player && r.player.outOfPlan && !readOnly) {
        // a raider outside "Gruppen im Plan" (#529) the row still names: he keeps his place, the chip warns like a missing place
        const tip = r.player.bench ? t("raidBoard.groups.outBench", { name: r.player.character }) : t("raidBoard.groups.outGroup", { name: r.player.character, n: r.player.group });
        return <span className="rp-lc is-open is-out" data-tip={tip} aria-label={tip}>{no}<TokenIcon player={r.player} size="sm" /><PlayerName player={r.player} /><AlertTriangle size={12} aria-hidden="true" /></span>;
    }
    if (r.player) {
        // a player outside his spec role on a tanking row (a mage tank) says so: class name in the tooltip, "als Tank" beside the name
        // the sheet: the full name in the tooltip (a very long one ends in "…" on the chip)
        return <span className={`rp-lc${mine && readOnly ? " is-me" : ""}`} data-tip={asTank ? `${t(`wow.class.${r.player.classId}`)} · ${t("raidBoard.class.asTank")}` : readOnly ? playerLabel(r.player) : undefined}>{no}<TokenIcon player={r.player} size="sm" /><PlayerName player={r.player} />{asTank && <span className="rp-lc-as">{t("raidBoard.class.asTank")}</span>}{mine && readOnly && <span className="rp-lc-du">{t("raidBoard.public.du")}</span>}</span>;
    }
    if (r.kind === "class") return <span className={`rp-lc ${open ? "is-open" : "is-slot"}`}>{no}{r.classId === ANY ? <RoleGlyph role={r.role} size={16} /> : <WowIcon name={r.icon} size={16} />}<span>{open ? t("raidBoard.aline.missing", { what: r.label }) : r.label}</span>{open && <AlertTriangle size={12} aria-hidden="true" />}</span>;
    if (r.kind === "slot") return <span className={`rp-lc ${open ? "is-open" : "is-slot"}`}>{no}<RoleGlyph role={r.role} size={16} /><span>{r.label}</span>{open && <AlertTriangle size={12} aria-label={t("raidBoard.slot.open")} />}</span>;
    if (r.kind === "role") return <span className="rp-lc is-role" style={{ "--rc": ROLE_TONE[r.role] } as React.CSSProperties}>{no}<RoleGlyph role={r.role} size={16} /><span>{r.label}</span></span>;
    if (r.kind === "group") return <span className="rp-lc is-grp" style={{ "--rp-gline": groupColor(ctx.groupColors, r.group) } as React.CSSProperties}><span>{r.label}</span></span>;
    if (r.kind === "mob") return <span className="rp-lc is-mk" data-tip={readOnly ? r.label : undefined}><MobIcon icon={r.icon} size={18} /><span>{r.label}</span></span>;
    if (r.kind === "mark") return <span className="rp-lc is-mk"><MarkIcon mark={r.mark as never} size={16} /><span>{r.label}</span></span>;
    if (r.kind === "text") return <span className="rp-lc is-mk"><WowIcon name={iconForText(r.label) || "inv_misc_note_01"} size={16} /><span>{r.label}</span></span>;
    return <span className="rp-lc is-slot">{no}<span>{r.label}</span></span>;
}

/** From how many classes a priority stacks its chips vertically instead of side by side (#556): side by side ran out of room and
 * truncated ("Dru", "Pri", "Sha"). Since #559 already from 2 (draft "Editor aufgeräumt"): the count on top, one class per line with its
 * rank number and the class colour as a small dot; a single class keeps the inline look. */
const STACK_FROM = 2;

/**
 * The places of a class priority nobody fills yet (#525), compact: "1 x [icon] Paladin › [icon] Schamane", in an event yellow with "fehlt";
 * in a template quiet (nothing to resolve there). With 3 or more classes (#556) the names stack one per line instead - the same way several
 * target chips of a row already wrap onto their own line - each with a small order number, so a long priority never truncates a name.
 */
export function PrioChip({ classes, count, open, type }: { classes: string[]; count: number; open: boolean; type: string }) {
    const t = useT();
    const name = classes.map((c) => classPlaceNameFor(c, "", type)).join(" › ");
    const stacked = classes.length >= STACK_FROM;
    return (
        <span className={`rp-lc rp-lc-prio${stacked ? " is-stacked" : ""} ${open ? "is-open" : "is-slot"}`} data-tip={open ? t("raidBoard.aline.missing", { what: `${count} x ${name}` }) : t("raidBoard.prio.hint")}>
            <b className="rp-lc-cnt">{count} x</b>
            {stacked ? (
                <span className="rp-lc-pcstack">
                    {classes.map((c, i) => (
                        <span key={c} className="rp-lc-pcrow">
                            <span className="rp-lc-pcorder" aria-hidden="true">{i + 1}</span>
                            <span className="rp-lc-pcdot" style={{ "--cc": CLASS_COLOR[c] || "var(--muted)" } as CSSProperties} aria-hidden="true" />
                            <span className="rp-lc-pcname">{classPlaceNameFor(c, "", type)}</span>
                        </span>
                    ))}
                </span>
            ) : classes.map((c, i) => <span key={c} className="rp-lc-pc">{i > 0 && <span className="rp-lc-sep" aria-hidden="true">›</span>}<WowIcon name={classIconOf(c)} size={14} /><span>{classPlaceNameFor(c, "", type)}</span></span>)}
            {open && <><span>{t("raidBoard.prio.missing")}</span><AlertTriangle size={12} aria-hidden="true" /></>}
        </span>
    );
}

function Cell({ items, ctx, readOnly, side, type, badge = "" }: { items: LineItem[]; ctx: AssignCtx; readOnly?: boolean; side: string; type: string; badge?: string }) {
    const t = useT();
    return (
        <div className={`rp-line-cell is-${side}`} aria-label={t(side === "who" ? "raidBoard.aline.colWho" : "raidBoard.aline.colAt")} role="group">
            {badge && <span className="rp-line-dev">{badge}</span>}
            {items.map((x) => (x.kind === "prio" ? <PrioChip key={x.key} classes={x.classes || []} count={x.count} open={x.open} type={type} /> : x.kind === "ref" ? (
                <span key={x.key} className="rp-lref">
                    <span className="rp-lref-t"><ClassRefIcon classId={x.classId} role={x.role} size={13} />{classPlaceNameFor(x.classId, x.role, type)} x{x.count}</span>
                    {x.items.map((r, i) => <LineChip key={`${r.ref}${i}`} r={r} open={r.open && (r.kind === "class" || r.kind === "slot")} mine={!!r.player && x.mine} order={0} ctx={ctx} readOnly={readOnly} asTank={offRole(type, r.player)} />)}
                </span>
            ) : x.r ? <LineChip key={x.key} r={x.r} open={x.open} mine={x.mine} order={x.order} ctx={ctx} readOnly={readOnly} asTank={x.asTank} /> : null))}
        </div>
    );
}

/**
 * The "..." of a row (#559): what used to be two more icons on every inherited row (hide for this boss, the lock that says "inherited")
 * sits behind one accessible menu button, so a row shows the pencil and one dimmed "...".
 */
function RowMenu({ label, onHide }: { label: string; onHide?: () => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    return (
        <>
            <button
                ref={anchor} type="button" className={`rp-line-btn${open ? " is-on" : ""}`} aria-haspopup="menu" aria-expanded={open}
                aria-label={`${t("raidBoard.aline.more")}: ${label}`} data-tip={t("raidBoard.aline.more")} onClick={() => setOpen((o) => !o)}
            >
                <MoreHorizontal size={14} />
            </button>
            {open && (
                <Popover anchor={anchor} place={belowEndPlacement(4)} follow="close" onClose={() => setOpen(false)} className="rp-line-menu" role="menu">
                    {onHide && (
                        <button type="button" role="menuitem" className="rp-line-mi" onClick={() => { setOpen(false); onHide(); }}>
                            <EyeOff size={14} aria-hidden="true" />{t("raidBoard.defaults.hideRow")}
                        </button>
                    )}
                    <span role="menuitem" aria-disabled="true" className="rp-line-mi is-info" data-tip={t("raidBoard.defaults.inheritedTip")}>
                        <Lock size={14} aria-hidden="true" />{t("raidBoard.defaults.inheritedShort")}
                    </span>
                </Popover>
            )}
        </>
    );
}

/**
 * One assignment row as ONE container (option 1 of "Zeile mit Chip-Container"): spell icon | who | arrow | at whom | actions, the same columns
 * in every row of a card. The chips only show; the whole row is one button (the pencil's click area fills the container) that opens the row
 * dialog; note and delete sit above it. Tab reaches the row, Enter opens, Delete removes (after asking). A small line under it only when
 * there is a spell, a task text or a note. `readOnly` (the sheet): no actions, the viewer's own chip carries "DU" and frames the row.
 * `inherited` (a row from the template's Standard): a lock instead of the trash, the pencil makes it the section's own.
 */
export default function AssignLine({ a, filled, ctx, isEvent, readOnly, inherited, deviating, me = [], onOpen, onNote, onDelete, onHide, onMap }: {
    a: RaidplanAssignment;
    /** the row with its class references resolved (same order) */
    filled: RaidplanAssignment;
    ctx: AssignCtx;
    isEvent: boolean;
    readOnly?: boolean;
    inherited?: boolean;
    /** the row differs from the Standard for this boss only (#559): badge "nur dieser Boss" and a light accent background */
    deviating?: boolean;
    me?: string[];
    onOpen?: () => void;
    onNote?: () => void;
    /** `ask` = the Delete key (asks first); the trash removes at once (Ctrl+Z brings it back) */
    onDelete?: (ask: boolean) => void;
    onHide?: () => void;
    /** "Auf Map setzen" / "Von der Map nehmen" of a task row (lib/raidplan/autoPlace.ts canPutOnMap); missing = the row cannot (a tank row, only role groups) */
    onMap?: () => void;
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
    const cls = ["rp-line", state === "empty" ? "is-blank" : `is-${state}`, readOnly ? "is-ro" : "", inherited ? "is-lock" : "", deviating ? "is-dev" : "", mineRow ? "is-me" : "", a.suggested ? "is-suggested" : ""].filter(Boolean).join(" ");
    return (
        <li className={cls} onKeyDown={onKey}>
            <span className="rp-line-ico" data-tip={a.spell ? a.spell.name : typeName}><WowIcon name={icon} size={24} /></span>
            {state === "empty" ? (
                <span className="rp-line-empty">{t("raidBoard.aline.pickWho")}<ArrowRight size={15} aria-hidden="true" />{t("raidBoard.aline.pickTarget")}</span>
            ) : (
                <>
                    <Cell items={who} ctx={ctx} readOnly={readOnly} side="who" type={a.type} badge={deviating ? t("raidBoard.aline.devBadge") : ""} />
                    {at.length > 0 ? <ArrowRight className="rp-line-arr" size={16} aria-hidden="true" /> : <span className="rp-line-arr" aria-hidden="true" />}
                    <Cell items={at} ctx={ctx} readOnly={readOnly} side="at" type={a.type} />
                </>
            )}
            {!readOnly && (
                <div className="rp-line-acts">
                    {onOpen && <button type="button" className="rp-line-open rp-line-btn" aria-label={`${t(inherited ? "raidBoard.defaults.deviate" : "raidBoard.aline.edit")}: ${label}`} data-tip={t(inherited ? "raidBoard.defaults.deviate" : "raidBoard.aline.edit")} onClick={onOpen}><Pencil size={14} /></button>}
                    {inherited ? (
                        <RowMenu label={label} onHide={onHide} />
                    ) : (
                        <>
                            {onMap && <button type="button" className={`rp-line-btn${a.onMap ? " is-on is-map" : ""}`} aria-pressed={!!a.onMap} aria-label={t(a.onMap ? "raidBoard.auto.offMap" : "raidBoard.auto.onMap")} data-tip={a.onMap ? t("raidBoard.auto.offMap") : `${t("raidBoard.auto.onMap")}: ${t("raidBoard.auto.onMapTip")}`} onClick={onMap}><MapPin size={14} /></button>}
                            {onNote && <button type="button" className={`rp-line-btn${a.note ? " is-on" : ""}`} aria-label={t("raidBoard.assign.addNote")} data-tip={a.note || t("raidBoard.assign.addNote")} onClick={onNote}><StickyNote size={14} /></button>}
                            {onDelete && <button type="button" className="rp-line-btn is-danger" aria-label={t("raidBoard.assign.delete")} data-tip={t("raidBoard.assign.delete")} onClick={() => onDelete(false)}><Trash2 size={14} /></button>}
                        </>
                    )}
                </div>
            )}
            {sub.length > 0 && (
                <div className="rp-line-sub" data-tip={sub.join(" · ") || undefined}>
                    {sub.map((s, i) => <span key={i} className={i === 0 && a.spell ? "rp-line-sp" : ""}>{s}</span>)}
                </div>
            )}
        </li>
    );
}
