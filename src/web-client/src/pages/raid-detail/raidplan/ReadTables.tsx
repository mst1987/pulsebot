import { useMemo, type ReactNode } from "react";
import { Users } from "lucide-react";
import type { RaidplanAssignment } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ASSIGN_META, ROLE_ICON, iconForText, isMe, isMine, myTasks, tasksByAssignee, type AssignCtx, type Resolved } from "../../../lib/assign";
import { groupHealTable, simpleTables, tankTable } from "../../../lib/planTables";
import { MobIcon } from "./AssignPanel";
import TypeBadge from "./TypeBadge";
import { useT } from "../../../i18n";

/** Who or what a cell names: a person with class icon and class colour, an open place with its role, a mob with its portrait, a mark, a group, a word. */
function Who({ r, mine }: { r: Resolved; mine: boolean }) {
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
    else if (r.kind === "text") body = <><WowIcon name={iconForText(r.label) || "inv_misc_note_01"} size={24} /><span>{r.label}</span></>;
    else {
        body = (
            <>
                {r.kind === "slot" && ROLE_ICON[r.role] && <WowIcon name={ROLE_ICON[r.role]} size={24} />}
                <span className="rp-who-open">{r.label}</span>
            </>
        );
    }
    return <span className={`rp-who${mine ? " is-own" : ""}`}>{body}</span>;
}

function WhoList({ list, me }: { list: Resolved[]; me: string[] }) {
    if (list.length === 0) return <span className="rp-muted">–</span>;
    return <span className="rp-who-list">{list.map((r) => <Who key={`${r.kind}|${r.ref}`} r={r} mine={isMe(r, me)} />)}</span>;
}

/**
 * The read view's assignments as real tables: first "Meine Einteilungen" (for a visitor who was recognised), then
 * Tank | Ziel | Heiler, Heiler | Gruppen, and a slim table per other type. Rows of the visitor are highlighted.
 */
export default function ReadTables({ assignments, ctx, me, loggedIn, loginHref }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[]; loggedIn: boolean; loginHref: string }) {
    const t = useT();
    const mine = useMemo(() => myTasks(assignments, ctx, me), [assignments, ctx, me]);
    const tanks = useMemo(() => tankTable(assignments, ctx, (a) => isMine(a, ctx, me)), [assignments, ctx, me]);
    const groups = useMemo(() => groupHealTable(assignments, ctx), [assignments, ctx]);
    const others = useMemo(() => simpleTables(assignments, ctx), [assignments, ctx]);
    return (
        <div className="rp-rtables">
            {me.length > 0 ? (
                mine.length > 0 ? (
                    <section className="rp-mine" aria-label={t("raidBoard.read.mine")}>
                        <h2>{t("raidBoard.read.mine")}</h2>
                        <ul>
                            {mine.map((k) => (
                                <li key={k.id}>
                                    <TypeBadge type={k.type} size={30} />
                                    <span className="rp-mine-text">{k.text}</span>
                                </li>
                            ))}
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
                                    <td><Who r={r.tank} mine={isMe(r.tank, me)} /></td>
                                    <td>{r.target ? <Who r={r.target} mine={false} /> : <span className="rp-muted">–</span>}</td>
                                    <td><WhoList list={r.healers} me={me} /></td>
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
                                    <td><WhoList list={r.healers} me={me} /></td>
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
                                    <td><WhoList list={r.who} me={me} /></td>
                                    <td>
                                        {(r.spell || r.task) && <span className="rp-rtask">{[r.spell, r.task].filter(Boolean).join(": ")}</span>}
                                        {r.targets.length > 0 && <WhoList list={r.targets} me={me} />}
                                        {!r.spell && !r.task && r.targets.length === 0 && <span className="rp-muted">–</span>}
                                        {r.note && <span className="rp-muted rp-rnote">{r.note}</span>}
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

/** "Tasks by player" as a log at the end of a section: a grid of player chips with their task badges, foldable. */
export function ByPlayerLog({ assignments, ctx, me }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[] }) {
    const t = useT();
    const all = useMemo(() => tasksByAssignee(assignments, ctx), [assignments, ctx]);
    if (all.length === 0) return null;
    return (
        <details className="rp-bylog" open>
            <summary>{t("raidBoard.assign.byPlayer")} · {all.length}</summary>
            <ul className="rp-bylog-grid">
                {all.map((row) => (
                    <li key={row.key} className={isMe(row.who, me) ? "is-own" : ""}>
                        <Who r={row.who} mine={isMe(row.who, me)} />
                        <span className="rp-bylog-tasks">
                            {row.tasks.map((k) => <span key={k.id} className={`rp-tbadge rp-tb-${k.type in ASSIGN_META ? k.type : "other"} is-small`} data-tip={k.text}><WowIcon name={k.icon} size={18} /><span>{k.text}</span></span>)}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );
}
