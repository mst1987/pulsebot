import { useMemo, type ReactNode } from "react";
import { ArrowRight, ListChecks, Users } from "lucide-react";
import type { RaidplanAssignment } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ROLE_ICON, iconForTask, iconForText, isMe, resolveAssignee, resolveTarget, type AssignCtx, type Resolved } from "../../../lib/assign";
import { cleanNames } from "../../../lib/mention";
import Mentions from "../../../components/raidplan/Mentions";
import { groupHealTable, simpleTables, tankTable } from "../../../lib/planTables";
import { mineCard, splitMine, type MineBlock } from "../../../lib/mineView";
import { groupColor, groupMark, inkOn } from "../../../lib/groupStyle";
import { MobIcon } from "./AssignPanel";
import TypeBadge from "./TypeBadge";
import { useT } from "../../../i18n";

/** Who or what a cell names: a person with class icon and class colour, an open place with its role, a mob with its portrait, a mark, a group, a word. */
function Who({ r, mine, names = [], ctx }: { r: Resolved; mine: boolean; names?: string[]; ctx?: AssignCtx }) {
    const t = useT();
    let body: ReactNode;
    if (r.player) {
        body = (
            <>
                <TokenIcon player={r.player} size="sm" />
                <PlayerName player={r.player} className={mine ? "is-me" : ""} />
            </>
        );
    } else if (r.kind === "mob") body = <><MobIcon icon={r.icon} size={32} /><strong>{r.label}</strong></>;
    else if (r.kind === "mark") body = <><MarkIcon mark={r.mark as never} size={28} /><span>{r.label}</span></>;
    else if (r.kind === "class") body = <><WowIcon name={r.icon} size={24} /><span className="rp-who-open">{r.label} ({t("raidBoard.class.missing")})</span></>;
    else if (r.kind === "group") {
        const col = groupColor(ctx ? ctx.groupColors : undefined, r.group);
        const mk = groupMark(ctx ? ctx.groupMarks : undefined, r.group);
        body = <span className="rp-gtag" style={{ "--gc": col, "--gi": inkOn(col) } as React.CSSProperties}><Users size={18} aria-hidden="true" /><strong>{r.label}</strong>{mk && <MarkIcon mark={mk as never} size={18} />}</span>;
    }
    else if (r.kind === "text") body = <><WowIcon name={iconForText(r.label) || "inv_misc_note_01"} size={24} /><span><Mentions text={r.label} names={names} /></span></>;
    else {
        body = (
            <>
                {r.kind === "slot" && ROLE_ICON[r.role] && <WowIcon name={ROLE_ICON[r.role]} size={24} />}
                <span className="rp-who-open">{r.label}</span>
            </>
        );
    }
    return <span className={`rp-who${mine ? " is-own" : ""}`} {...(mine ? { "data-tip": t("raidBoard.public.thatsYou"), "aria-label": `${r.label}: ${t("raidBoard.public.thatsYou")}` } : {})}>{body}{mine && <span className="rp-du" aria-hidden="true">{t("raidBoard.public.du")}</span>}</span>;
}

function WhoList({ list, me, names = [], ctx }: { list: Resolved[]; me: string[]; names?: string[]; ctx?: AssignCtx }) {
    if (list.length === 0) return <span className="rp-muted">–</span>;
    return <span className="rp-who-list">{list.map((r) => <Who key={`${r.kind}|${r.ref}`} r={r} mine={isMe(r, me)} names={names} ctx={ctx} />)}</span>;
}

/**
 * The blocks of "Meine Aufgaben" (cards of mode "do") and "Wirkt auf dich" (mode "on"): one block per kind of task (its icon and name as the head), in it ONE
 * CARD per assignment in fixed columns - [icon] | who | arrow | at whom / what | extras. All targets of a row sit in its card; what acts on the visitor
 * shows who does it and himself (or his group) as the one highlighted receiver. The columns are shared by the cards of a block (a subgrid).
 */
function MineBlocks({ blocks, ctx, me, names }: { blocks: MineBlock[]; ctx: AssignCtx; me: string[]; names: string[] }) {
    const t = useT();
    return (
        <>
            {blocks.map((b) => (
                <section key={b.group} className="rp-mineblk" aria-label={t(`raidBoard.mine.group.${b.group}`)}>
                    <h3><TypeBadge type={b.badge} label={t(`raidBoard.mine.group.${b.group}`)} /></h3>
                    <ul className="rp-mgrid">
                        {b.rows.map((r) => {
                            const card = mineCard(r);
                            const a = r.a;
                            const lead = a.spell && a.spell.icon ? a.spell.icon : iconForTask(a);
                            return (
                                <li key={card.id} className="rp-mcard">
                                    <span className="rp-mcard-ico"><WowIcon name={lead} size={34} /></span>
                                    <span className="rp-mcard-who">
                                        {card.whoMe ? <span className="rp-me-chip">{t("raidBoard.mine.you")}</span> : <WhoList list={card.who.map((ref) => resolveAssignee(ref, ctx))} me={me} names={names} ctx={ctx} />}
                                    </span>
                                    <ArrowRight className="rp-mcard-arrow" size={18} aria-hidden="true" />
                                    <span className="rp-mcard-to">
                                        {card.whoMe
                                            ? (card.to.length > 0 ? <WhoList list={card.to.map((tg) => resolveTarget(tg, ctx))} me={me} names={names} ctx={ctx} /> : <span className="rp-muted">{"\u2013"}</span>)
                                            : <span className="rp-recipient">{card.recipient === "group" ? t("raidBoard.mine.yourGroup", { n: card.group }) : t("raidBoard.mine.you")}</span>}
                                    </span>
                                    <span className="rp-mcard-note">
                                        {card.text && <span className="rp-mine-text"><Mentions text={card.text} names={names} /></span>}
                                        {card.order > 0 && <span className="rp-achip-no">{card.order}</span>}
                                        {card.alsoOnMe && <span className="rp-also-onyou">{t("raidBoard.mine.alsoOnYou")}</span>}
                                        {card.note && <span className="rp-muted"><Mentions text={card.note} names={names} /></span>}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </>
    );
}

/**
 * The read view's assignments as real tables: first "Meine Einteilungen" (for a visitor who was recognised), then
 * Tank | Ziel | Heiler, Heiler | Gruppen, and a slim table per other type. Rows of the visitor are highlighted.
 */
export default function ReadTables({ assignments, ctx, me, loggedIn, loginHref, focusGroup = 0, onFocusGroup }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[]; loggedIn: boolean; loginHref: string; focusGroup?: number; onFocusGroup?: (n: number) => void }) {
    const t = useT();
    // the visitor's own characters by name: for the names in words (notes, free text)
    const names = useMemo(() => cleanNames(me.map((id) => (ctx.players.get(id) || { character: "" }).character)), [me, ctx.players]);
    const split = useMemo(() => splitMine(assignments, ctx, me, names), [assignments, ctx, me, names]);
    const tanks = useMemo(() => tankTable(assignments, ctx, (a) => split.modes[a.id] === "do"), [assignments, ctx, split]);
    /** how a row of a table concerns the visitor: his own task, or something that acts on him */
    const rowCls = (id: string) => (split.modes[id] === "do" ? "is-own" : split.modes[id] === "on" ? "is-onme" : "");
    const groups = useMemo(() => groupHealTable(assignments, ctx), [assignments, ctx]);
    const others = useMemo(() => simpleTables(assignments, ctx), [assignments, ctx]);
    return (
        <div className="rp-rtables">
            <div className="rp-personal">
            {me.length === 0 ? (
                <p className="rp-muted rp-mine-hint">{loggedIn ? t("raidBoard.read.notInPlan") : <>{t("raidBoard.read.loginHint")} <a className="mlink" href={loginHref}>{t("raidBoard.public.login")}</a></>}</p>
            ) : split.mine.length === 0 && split.onMe.length === 0 ? (
                <p className="rp-muted rp-mine-hint">{t("raidBoard.read.notInPlan")}</p>
            ) : (
                <>
                    {split.mine.length > 0 && (
                        <section className="rp-mine" aria-label={t("raidBoard.mine.title")}>
                            <h2>{t("raidBoard.mine.title")}</h2>
                            <MineBlocks blocks={split.mine} ctx={ctx} me={me} names={names} />
                        </section>
                    )}
                    {split.onMe.length > 0 && (
                        <section className="rp-onme" aria-label={t("raidBoard.mine.onMe")}>
                            <h2>{t("raidBoard.mine.onMe")}</h2>
                            <MineBlocks blocks={split.onMe} ctx={ctx} me={me} names={names} />
                        </section>
                    )}
                </>
            )}
            </div>

            {(tanks.length > 0 || groups.length > 0 || others.length > 0) && (
            <details className="rp-allzone" open>
                <summary><ListChecks size={18} aria-hidden="true" /><h2>{t("raidBoard.mine.all")}</h2></summary>
                <div className="rp-rgrid">
            {tanks.length > 0 && (
                <section className="rp-rsec" aria-label={t("raidBoard.assign.type.tank")}>
                    <h3><TypeBadge type="tank" /></h3>
                    <table className="rp-rtable">
                        <thead><tr><th>{t("raidBoard.read.colTank")}</th><th>{t("raidBoard.read.colTarget")}</th><th>{t("raidBoard.read.colHealers")}</th></tr></thead>
                        <tbody>
                            {tanks.map((r) => (
                                <tr key={r.key} className={r.own ? "is-own" : rowCls(r.rowId)}>
                                    <td><Who r={r.tank} mine={isMe(r.tank, me)} names={names} /></td>
                                    <td>{r.target ? <Who r={r.target} mine={isMe(r.target, me)} names={names} /> : <span className="rp-muted">–</span>}</td>
                                    <td><WhoList list={r.healers} me={me} names={names} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}

            {groups.length > 0 && (
                <section className="rp-rsec" aria-label={t("raidBoard.read.groupHeal")}>
                    <h3><TypeBadge type="heal" label={t("raidBoard.read.groupHeal")} /></h3>
                    <table className="rp-rtable">
                        <thead><tr><th>{t("raidBoard.read.colHealer")}</th><th>{t("raidBoard.read.colGroups")}</th></tr></thead>
                        <tbody>
                            {groups.map((r) => (
                                <tr key={r.key} className={r.healers.some((h) => isMe(h, me)) ? "is-own" : rowCls(r.rowId)}>
                                    <td><WhoList list={r.healers} me={me} names={names} /></td>
                                    <td>
                                        <span className="rp-who-list">
                                            {r.groups.map((g) => (
                                                <span key={g} className={`rp-gbadge${ctx.players.size > 0 && me.some((id) => (ctx.players.get(id) || { group: -1 }).group === g) ? " is-own" : ""}${focusGroup === g ? " is-focus" : ""}`} style={{ "--gc": groupColor(ctx.groupColors, g), "--gi": inkOn(groupColor(ctx.groupColors, g)) } as React.CSSProperties} role={onFocusGroup ? "button" : undefined} tabIndex={onFocusGroup ? 0 : undefined} onClick={onFocusGroup ? () => onFocusGroup(focusGroup === g ? 0 : g) : undefined} onKeyDown={onFocusGroup ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocusGroup(focusGroup === g ? 0 : g); } } : undefined}><Users size={15} aria-hidden="true" />{g}{groupMark(ctx.groupMarks, g) && <MarkIcon mark={groupMark(ctx.groupMarks, g) as never} size={15} />}</span>
                                            ))}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}

            {others.map((tb) => (
                <section key={tb.type} className="rp-rsec" aria-label={t(`raidBoard.assign.type.${tb.type}`)}>
                    <h3><TypeBadge type={tb.type} /></h3>
                    <table className="rp-rtable">
                        <thead>
                            <tr>
                                {tb.rows.some((r) => r.order > 0) && <th className="rp-col-no">{t("raidBoard.read.colOrder")}</th>}
                                <th>{t("raidBoard.read.colPlayer")}</th>
                                <th>{tb.type === "kick" ? t("raidBoard.read.colTargetAbility") : t("raidBoard.read.colTarget")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tb.rows.map((r) => (
                                <tr key={r.key} className={r.who.some((w) => isMe(w, me)) ? "is-own" : rowCls(r.rowId)}>
                                    {tb.rows.some((x) => x.order > 0) && <td className="rp-col-no">{r.order > 0 ? <span className="rp-achip-no">{r.order}</span> : "–"}</td>}
                                    <td><WhoList list={r.who} me={me} names={names} /></td>
                                    <td>
                                        {(r.spell || r.task) && <span className="rp-rtask"><Mentions text={[r.spell, r.task].filter(Boolean).join(": ")} names={names} /></span>}
                                        {r.targets.length > 0 && <WhoList list={r.targets} me={me} names={names} />}
                                        {!r.spell && !r.task && r.targets.length === 0 && <span className="rp-muted">–</span>}
                                        {r.note && <span className="rp-muted rp-rnote"><Mentions text={r.note} names={names} /></span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            ))}
                </div>
            </details>
            )}
        </div>
    );
}
