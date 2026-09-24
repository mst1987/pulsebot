import { useMemo, type ReactNode } from "react";
import { ArrowRight, Users } from "lucide-react";
import type { RaidplanAssignment } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ROLE_ICON, iconForText, isMe, resolveAssignee, resolveTarget, type AssignCtx, type Resolved } from "../../../lib/assign";
import { cleanNames } from "../../../lib/mention";
import Mentions from "../../../components/raidplan/Mentions";
import { groupHealTable, simpleTables, tankTable } from "../../../lib/planTables";
import { splitMine, type MineBlock } from "../../../lib/mineView";
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
    else if (r.kind === "class") body = <><WowIcon name={r.icon} size={24} /><span className="rp-who-open">{r.label} ({t("raidBoard.class.missing")})</span></>;
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

/** The verbs of the rows that act on the visitor ("Heilt dich", "Heilt deine Gruppe (4)"); the kinds of task without their own wording use the type's name. */
const OWN_VERBS = ["heal", "md", "ss", "fearward", "tank"];

/** The blocks of "Meine Aufgaben" (mode "do": I -> target) and "Auf mich wirkend" (mode "on": who -> YOU), grouped by kind of task. */
function MineBlocks({ blocks, mode, ctx, me, names }: { blocks: MineBlock[]; mode: string; ctx: AssignCtx; me: string[]; names: string[] }) {
    const t = useT();
    return (
        <>
            {blocks.map((b) => (
                <div key={b.group} className="rp-mineblk">
                    <h3><TypeBadge type={b.badge} label={t(`raidBoard.mine.group.${b.group}`)} /></h3>
                    <ul>
                        {b.rows.map((r) => {
                            const a = r.a;
                            const text = [a.spell ? a.spell.name : "", a.title].filter(Boolean).join(": ");
                            if (mode === "do") {
                                return (
                                    <li key={a.id} className="rp-mine-row">
                                        {text && <span className="rp-mine-text"><Mentions text={text} names={names} /></span>}
                                        <span className="rp-mine-me">{t("raidBoard.mine.me")}</span>
                                        <ArrowRight size={16} aria-hidden="true" />
                                        {a.targets.length > 0 ? <WhoList list={a.targets.map((tg) => resolveTarget(tg, ctx))} me={me} names={names} /> : <span className="rp-muted">{"\u2013"}</span>}
                                        {r.order > 0 && <span className="rp-achip-no">{r.order}</span>}
                                        {r.alsoOnMe && <span className="rp-also-onyou">{t("raidBoard.mine.alsoOnYou")}</span>}
                                        {a.note && <span className="rp-muted rp-mine-note"><Mentions text={a.note} names={names} /></span>}
                                    </li>
                                );
                            }
                            const type = a.type === "trashtank" ? "tank" : a.type;
                            const key = OWN_VERBS.indexOf(type) >= 0 ? type : "generic";
                            const verb = r.via === "text" ? t("raidBoard.mine.on.text", { type: t(`raidBoard.assign.type.${a.type}`) }) : t(`raidBoard.mine.on.${r.via}.${key}`, { n: r.group, type: t(`raidBoard.assign.type.${a.type}`) });
                            return (
                                <li key={a.id} className="rp-mine-row is-onme">
                                    <span className="rp-onme-badge">{t("raidBoard.mine.onYou")}</span>
                                    <span className="rp-onme-verb">{verb}</span>
                                    {text && <span className="rp-mine-text"><Mentions text={text} names={names} /></span>}
                                    <WhoList list={a.assignees.map((ref) => resolveAssignee(ref, ctx))} me={me} names={names} />
                                    <ArrowRight size={16} aria-hidden="true" />
                                    <span className="rp-onme-you">{t("raidBoard.mine.you")}</span>
                                    {a.note && <span className="rp-muted rp-mine-note"><Mentions text={a.note} names={names} /></span>}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </>
    );
}

/**
 * The read view's assignments as real tables: first "Meine Einteilungen" (for a visitor who was recognised), then
 * Tank | Ziel | Heiler, Heiler | Gruppen, and a slim table per other type. Rows of the visitor are highlighted.
 */
export default function ReadTables({ assignments, ctx, me, loggedIn, loginHref }: { assignments: RaidplanAssignment[]; ctx: AssignCtx; me: string[]; loggedIn: boolean; loginHref: string }) {
    const t = useT();
    // the visitor's own characters by name: for the names in words (notes, free text)
    const names = useMemo(() => cleanNames(me.map((id) => (ctx.players.get(id) || { character: "" }).character)), [me, ctx.players]);
    const split = useMemo(() => splitMine(assignments, ctx, me, names), [assignments, ctx, me, names]);
    const tanks = useMemo(() => tankTable(assignments, ctx, (a) => split.modes[a.id] === "do"), [assignments, ctx, split]);
    /** how a row of a table concerns the visitor: his own task, or something that acts on him */
    const rowCls = (id: string) => (split.modes[id] === "do" ? "is-own" : split.modes[id] === "on" ? "is-onme" : "");
    const onYou = (id: string) => (split.modes[id] === "on" ? <span className="rp-onme-badge is-small">{t("raidBoard.mine.onYou")}</span> : null);
    const groups = useMemo(() => groupHealTable(assignments, ctx), [assignments, ctx]);
    const others = useMemo(() => simpleTables(assignments, ctx), [assignments, ctx]);
    return (
        <div className="rp-rtables">
            {me.length === 0 ? (
                <p className="rp-muted rp-mine-hint">{loggedIn ? t("raidBoard.read.notInPlan") : <>{t("raidBoard.read.loginHint")} <a className="mlink" href={loginHref}>{t("raidBoard.public.login")}</a></>}</p>
            ) : split.mine.length === 0 && split.onMe.length === 0 ? (
                <p className="rp-muted rp-mine-hint">{t("raidBoard.read.notInPlan")}</p>
            ) : (
                <>
                    {split.mine.length > 0 && (
                        <section className="rp-mine" aria-label={t("raidBoard.mine.title")}>
                            <h2>{t("raidBoard.mine.title")}</h2>
                            <MineBlocks blocks={split.mine} mode="do" ctx={ctx} me={me} names={names} />
                        </section>
                    )}
                    {split.onMe.length > 0 && (
                        <section className="rp-onme" aria-label={t("raidBoard.mine.onMe")}>
                            <h2>{t("raidBoard.mine.onMe")}</h2>
                            <MineBlocks blocks={split.onMe} mode="on" ctx={ctx} me={me} names={names} />
                        </section>
                    )}
                    <h2 className="rp-allhead">{t("raidBoard.mine.all")}</h2>
                </>
            )}

            {tanks.length > 0 && (
                <section className="rp-rsec" aria-label={t("raidBoard.assign.type.tank")}>
                    <h3><TypeBadge type="tank" /></h3>
                    <table className="rp-rtable">
                        <thead><tr><th>{t("raidBoard.read.colTank")}</th><th>{t("raidBoard.read.colTarget")}</th><th>{t("raidBoard.read.colHealers")}</th></tr></thead>
                        <tbody>
                            {tanks.map((r) => (
                                <tr key={r.key} className={r.own ? "is-own" : rowCls(r.rowId)}>
                                    <td><Who r={r.tank} mine={isMe(r.tank, me)} names={names} />{onYou(r.rowId)}</td>
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
                                    <td><WhoList list={r.healers} me={me} names={names} />{onYou(r.rowId)}</td>
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
                                <tr key={r.key} className={r.who.some((w) => isMe(w, me)) ? "is-own" : rowCls(r.rowId)}>
                                    {tb.rows.some((x) => x.order > 0) && <td className="rp-col-no">{r.order > 0 ? <span className="rp-achip-no">{r.order}</span> : "–"}</td>}
                                    <td><WhoList list={r.who} me={me} names={names} />{onYou(r.rowId)}</td>
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
