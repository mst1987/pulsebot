import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { getServerRoleDetail, type DiscordSide, type ServerRoleChannel, type ServerRoleDetail, type ServerRoleMember } from "../../api";
import { useApi } from "../../hooks/useApi";
import { IconButton, Switch } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { SearchIcon, XIcon } from "../../components/ui/icons";
import { ALL_PERMISSIONS, groupPermissions, permissionLabel } from "../../lib/discord/permissions";
import { assignView, botRelation, initialsOf, matchesMember, roleUseLines } from "../../lib/discord/serverRoles";
import { useT } from "../../i18n";

// One role in a drawer at the right edge (like the absences' raider drawer): the
// facts first (position, members, what it means for the bot, whether the bot can
// hand it out), then its permissions grouped as in Discord — only the set ones
// unless "Alle Rechte zeigen" is on —, the channels with an override for it and
// the members with a search. Esc or the X closes it.

/** Members shown before the search has to narrow it down. */
const MEMBERS_SHOWN = 60;

export default function ServerRoleDrawer({ side, roleId, guildName, rank, counted, onClose }: {
    side: DiscordSide;
    roleId: string;
    guildName: string;
    /** the rank the table shows for the role (1 = highest; null for @everyone) */
    rank: number | null;
    /** the roles without @everyone, for "5 von 15" */
    counted: number;
    onClose: () => void;
}) {
    const t = useT();
    const state = useApi(() => getServerRoleDetail(side, roleId), [side, roleId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
            onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const data = state.data;
    const role = data && data.role;
    return (
        <>
            {/* on a phone the drawer is a bottom sheet over the table: a tap beside it closes it */}
            <div className="drl-backdrop" aria-hidden="true" onClick={onClose} />
            <aside className="drl-drawer" aria-label={role ? role.name : t("discord.roles.drawer.loading")}>
                <div className="drl-drawer-head">
                    <div className="drl-drawer-title">
                        <span className="kicker">{t("discord.roles.drawer.kicker", { guild: guildName })}</span>
                        {role && (
                            <h2 className={role.color ? "drl-coloured" : undefined} style={role.color ? ({ "--drl-color": role.color } as CSSProperties) : undefined}>
                                <span className="drl-dot" aria-hidden="true" />{role.everyone ? "@everyone" : role.name}
                            </h2>
                        )}
                    </div>
                    <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={onClose} />
                </div>
                <div className="drl-drawer-body">
                    {state.error && !data && (
                        <p className="drl-empty">{state.error.code === "not_found" ? t("discord.roles.drawer.gone") : t("discord.roles.drawer.loadError", { message: state.error.message })}</p>
                    )}
                    {!data && !state.error && <RaidLoader compact text={t("discord.roles.drawer.loading")} />}
                    {data && !role && <p className="drl-empty">{t("discord.roles.drawer.gone")}</p>}
                    {data && role && <Detail side={side} data={data} rank={rank} counted={counted} />}
                </div>
            </aside>
        </>
    );
}

const WHERE_KEY = { below: "belowBot", above: "aboveBot", own: "ownRole" } as const;

function Detail({ side, data, rank, counted }: { side: DiscordSide; data: ServerRoleDetail; rank: number | null; counted: number }) {
    const t = useT();
    const role = data.role!;
    const botName = data.botRole ? data.botRole.name : "";
    const assign = assignView(role, botName);
    const relation = botRelation(role);
    const where = relation ? t(`discord.roles.drawer.${WHERE_KEY[relation]}`) : "";
    return (
        <>
            <dl className="drl-facts">
                {!role.everyone && rank !== null && rank > 0 && (
                    <><dt>{t("discord.roles.drawer.position")}</dt><dd>{t("discord.roles.drawer.positionOf", { pos: rank, total: counted })}{where ? `, ${where}` : ""}</dd></>
                )}
                <dt>{t("discord.roles.drawer.members")}</dt>
                <dd>{role.memberCount === null ? t("discord.roles.cell.membersUnknown") : t("discord.roles.cell.members", { count: role.memberCount })}</dd>
                <dt>{t("discord.roles.drawer.forBot")}</dt>
                <dd>{roleUseLines(role).join(" · ")}</dd>
                <dt>{t("discord.roles.drawer.assign")}</dt>
                <dd className={`drl-assign-${assign.tone}`}>
                    {role.assign.ok ? t("discord.roles.drawer.assignYes") : <>{t("discord.roles.drawer.assignNo")} – {assign.text}{assign.sub ? <span className="drl-sub">{assign.sub}</span> : null}</>}
                </dd>
            </dl>
            <Permissions set={role.permissions} />
            <Channels channels={data.channels} />
            <Members side={side} members={data.members} total={data.membersTotal ?? data.members.length} count={role.memberCount} />
        </>
    );
}

function Permissions({ set }: { set: string[] }) {
    const t = useT();
    const [all, setAll] = useState(false);
    const groups = groupPermissions(set, all);
    const known = new Set(ALL_PERMISSIONS);
    const totalKnown = ALL_PERMISSIONS.length + set.filter((k) => !known.has(k)).length;
    return (
        <section className="drl-sec">
            <div className="drl-sec-head">
                <h3>{t("discord.roles.perms.title")}</h3>
                <Switch checked={all} onChange={setAll} label={t("discord.roles.perms.showAll")} tip={t("discord.roles.perms.showAllTip")} />
            </div>
            <p className="drl-note">
                {t("discord.roles.perms.count", { set: set.length, total: totalKnown })}
                {!all && set.length > 0 ? ` ${t("discord.roles.perms.onlySet")}` : ""}
            </p>
            {groups.length === 0 ? <p className="drl-empty">{t("discord.roles.perms.none")}</p> : groups.map((g) => (
                <div key={g.id} className="drl-pgroup">
                    <h4>{g.label}</h4>
                    {g.rows.map((r) => (
                        <div key={r.key} className={`drl-perm${r.set ? "" : " drl-unset"}${r.set && r.sensitive ? " drl-hot" : ""}`}>
                            <span>{r.label}</span>
                            <span className="drl-state">
                                {r.set ? (r.sensitive ? t("discord.roles.perms.sensitive") : t("discord.roles.perms.set")) : t("discord.roles.perms.notSet")}
                            </span>
                        </div>
                    ))}
                </div>
            ))}
        </section>
    );
}

function Channels({ channels }: { channels: ServerRoleChannel[] }) {
    const t = useT();
    const name = (c: ServerRoleChannel) => (c.kind === "category" ? t("discord.roles.channels.category", { name: c.name }) : c.kind === "voice" ? c.name : `#${c.name}`);
    const list = (keys: string[]) => (keys.length ? keys.map(permissionLabel).join(", ") : "–");
    return (
        <section className="drl-sec">
            <div className="drl-sec-head">
                <h3>{t("discord.roles.channels.title")}</h3>
                <span className="drl-note">{t("discord.roles.channels.count", { count: channels.length })}</span>
            </div>
            {channels.length === 0 ? <p className="drl-empty">{t("discord.roles.channels.none")}</p> : (
                <table className="drl-ch">
                    <thead>
                        <tr><th>{t("discord.roles.channels.channel")}</th><th>{t("discord.roles.channels.allow")}</th><th>{t("discord.roles.channels.deny")}</th></tr>
                    </thead>
                    <tbody>
                        {channels.map((c) => (
                            <tr key={c.id}>
                                <td className="drl-ch-name">{name(c)}</td>
                                <td className={c.allow.length ? "drl-allow" : "drl-muted"}>{list(c.allow)}</td>
                                <td className={c.deny.length ? "drl-deny" : "drl-muted"}>{list(c.deny)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function Members({ side, members, total, count }: {
    side: DiscordSide;
    /** for @everyone only the first EVERYONE_MEMBERS_MAX (src/services/discord/serverRoles.js) */
    members: ServerRoleMember[];
    /** everyone with the role, also those not sent */
    total: number;
    count: number | null;
}) {
    const t = useT();
    const [query, setQuery] = useState("");
    const hits = members.filter((m) => matchesMember(m.name, query));
    const shown = hits.slice(0, MEMBERS_SHOWN);
    return (
        <section className="drl-sec">
            <div className="drl-sec-head">
                <h3>{t("discord.roles.members.title")}</h3>
                {count !== null && <span className="drl-note">{t("discord.roles.cell.members", { count })}</span>}
            </div>
            {members.length === 0 ? <p className="drl-empty">{t("discord.roles.members.none")}</p> : (
                <>
                    {members.length > 8 && (
                        <label className="drl-search">
                            <SearchIcon />
                            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("discord.roles.members.search")} aria-label={t("discord.roles.members.search")} />
                        </label>
                    )}
                    {hits.length === 0 ? <p className="drl-empty">{t("discord.roles.members.noMatch", { query: query.trim() })}</p> : (
                        <ul className="drl-people">
                            {shown.map((m) => (
                                <li key={m.id}>
                                    <span className="drl-av" aria-hidden="true">{m.avatarUrl ? <img src={m.avatarUrl} alt="" loading="lazy" /> : initialsOf(m.name)}</span>
                                    <Link className="drl-person" to={`/channels/members?user=${encodeURIComponent(m.id)}${side === "talk" ? "&side=talk" : ""}`} data-tip={t("discord.members.drawer.showMember")}>{m.name}</Link>
                                    {m.bot && <span className="drl-tag">{t("discord.roles.members.bot")}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                    {hits.length > shown.length && <p className="drl-note">{t("discord.roles.members.more", { count: hits.length - shown.length })}</p>}
                    {total > members.length && <p className="drl-note">{t("discord.roles.members.capped", { count: members.length, total })}</p>}
                </>
            )}
        </section>
    );
}
