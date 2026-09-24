import { useMemo, type ReactNode } from "react";
import { Users } from "lucide-react";
import type { RaidplanAssignment } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ROLE_ICON, iconForText, isMe, isMine, resolveAssignee, resolveTarget, type AssignCtx, type Resolved } from "../../../lib/assign";
import { cleanNames } from "../../../lib/mention";
import Mentions from "../../../components/raidplan/Mentions";
import { groupHealTable, simpleTables, tankTable } from "../../../lib/planTables";
import { MobIcon } from "./AssignPanel";
import TypeBadge from "./TypeBadge";
import { useT } from "../../../i18n";

/** Who or what a cell names: a person with class icon and class colour, an open place with its role, a mob with its portrait, a mark, a group, a word. */
function Who({ r, mine, names = [] }: { r: Resolved; mine: boolean; names?: string[] }) {
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
    else if (r.kind === "group") body = <><Users size={20} aria-hidden="true" /><strong>{r.label}</strong></>;
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

function WhoList({ list, me, names = [] }: { list: Resolved[]; me: string[]; names?: string[] }) {
    if (list.length === 0) return <span className="rp-muted">–</span>;
    return <span className="rp-who-list">{list.map((r) => <Who key={`${r.kind}|${r.ref}`} r={r} mine={isMe(r, me)} names={names} />)}</span>;
}

/**
 * The read view's assignments as real tables: first "Meine Einteilungen" (for a visitor who was recognised), then
 * Tank | Ziel | Heiler, Heiler | Gruppen, and a slim table per other type. Rows of the visitor are highlighted.
 */
export default function ReadTables({ assignments, ctx, me, loggedIn, loginHref }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[]; loggedIn: boolean; loginHref: string }) {
    const t = useT();
    // the visitor's own characters by name: for the names in words (notes, free text)
    const names = useMemo(() => cleanNames(me.map((id) => (ctx.players.get(id) || { character: "" }).character)), [me, ctx.players]);
    const mineRows = useMemo(() => (me.length > 0 ? assignments.filter((a) => isMine(a, ctx, me, names)) : []), [assignments, ctx, me, names]);
    const tanks = useMemo(() => tankTable(assignments, ctx, (a) => isMine(a, ctx, me, names)), [assignments, ctx, me, names]);
    const groups = useMemo(() => groupHealTable(assignments, ctx), [assignments, ctx]);
    const others = useMemo(() => simpleTables(assignments, ctx), [assignments, ctx]);
    return (
        <div className="rp-rtables">
            {me.length > 0 ? (
                mineRows.length > 0 ? (
                    <section className="rp-mine" aria-label={t("raidBoard.read.mine")}>
                        <h2>{t("raidBoard.read.mine")}</h2>
                        <ul>
                            {mineRows.map((a) => {
                                const asAssignee = a.assignees.some((ref) => isMe(resolveAssignee(ref, ctx), me));
                                return (
                                    <li key={a.id}>
                                        <TypeBadge type={a.type} size={30} />
                                        {(a.spell || a.title) && <span className="rp-mine-text"><Mentions text={[a.spell ? a.spell.name : "", a.title].filter(Boolean).join(": ")} names={names} /></span>}
                                        {!asAssignee && a.assignees.length > 0 && <span className="rp-mine-from"><WhoList list={a.assignees.map((ref) => resolveAssignee(ref, ctx))} me={me} names={names} /><span className="rp-muted">→</span></span>}
                                        {a.targets.length > 0 && <WhoList list={a.targets.map((tg) => resolveTarget(tg, ctx))} me={me} names={names} />}
                                        {a.note && <span className="rp-muted rp-mine-note"><Mentions text={a.note} names={names} /></span>}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ) : <p className="rp-muted rp-mine-hint">{t("raidBoard.read.notInPlan")}</p>
            ) : (
                <p className="rp-muted rp-mine-hint">{loggedIn ? t("raidBoard.read.notInPlan") : <>{t("raidBoard.read.loginHint")} <a className="mlink" href={loginHref}>{t("raidBoard.public.login")}</a></>}</p>
            )}

            {tanks.length > 0 && (
                <section className="rp-rsec" aria-label={t("raidBoard.assign.type.tank")}>
                    <h3><TypeBadge type="tank" /></h3>
                    <table className="rp-rtable">
                        <thead><tr><th>{t("raidBoard.read.colTank")}</th><th>{t("raidBoard.read.colTarget")}</th><th>{t("raidBoard.read.colHealers")}</th></tr></thead>
                        <tbody>
                            {tanks.map((r) => (
                                <tr key={r.key} className={r.own ? "is-own" : ""}>
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
                                <tr key={r.key} className={r.healers.some((h) => isMe(h, me)) ? "is-own" : ""}>
                                    <td><WhoList list={r.healers} me={me} names={names} /></td>
                                    <td>
                                        <span className="rp-who-list">
                                            {r.groups.map((g) => (
                                                <span key={g} className={`rp-gbadge${ctx.players.size > 0 && me.some((id) => (ctx.players.get(id) || { group: -1 }).group === g) ? " is-own" : ""}`}><Users size={15} aria-hidden="true" />{g}</span>
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
                                <tr key={r.key} className={r.who.some((w) => isMe(w, me)) ? "is-own" : ""}>
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
    );
}
