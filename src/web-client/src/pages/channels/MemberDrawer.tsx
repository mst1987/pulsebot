import { useEffect, type CSSProperties } from "react";
import { getServerMemberDetail, type MemberChannel, type MemberChannelGroup, type ServerMember, type ServerMemberDetail } from "../../api";
import { useApi } from "../../hooks/useApi";
import { IconButton } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { XIcon } from "../../components/ui/icons";
import { classColorProps } from "../../components/character/ClassSpec";
import { initialsOf } from "../../lib/discord/serverRoles";
import { classColorOf, joinedDate, rostersOfCharacter, versionShort } from "../../lib/discord/members";
import { roleColorVars } from "../../lib/discord/roleColor";
import { useT } from "../../i18n";

// One member in a drawer at the right edge (a bottom sheet on a phone), like the
// role drawer: who it is and since when, its roles in their colours, its
// characters by version with the roster each is in, and the channels it can see,
// by category. Esc or the X closes it.

export default function MemberDrawer({ guildId, userId, guildName, listed, onClose }: {
    /** the server of the server list the member is shown for */
    guildId: string;
    userId: string;
    guildName: string;
    /** the member from the list, so the head shows before the detail is loaded */
    listed: ServerMember | null;
    onClose: () => void;
}) {
    const t = useT();
    const state = useApi(() => getServerMemberDetail(guildId, userId), [guildId, userId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
            onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const data = state.data;
    const member = (data && data.member) || listed;
    const joined = member ? joinedDate(member.joinedAt) : "";
    return (
        <>
            {/* on a phone the drawer is a bottom sheet over the table: a tap beside it closes it */}
            <div className="dmb-backdrop" aria-hidden="true" onClick={onClose} />
            <aside className="dmb-drawer" aria-label={member ? member.name : t("discord.members.drawer.loading")}>
                <div className="dmb-drawer-head">
                    {member && <span className="dmb-av dmb-av-lg" aria-hidden="true">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initialsOf(member.name)}</span>}
                    <div className="dmb-drawer-title">
                        <span className="kicker">{t("discord.members.drawer.kicker", { guild: guildName })}</span>
                        {member && <h2>{member.name}</h2>}
                        {member && (
                            <span className="dmb-note">
                                {[member.username, joined ? t("discord.members.drawer.joined", { date: joined }) : ""].filter(Boolean).join(" · ")}
                            </span>
                        )}
                    </div>
                    <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={onClose} />
                </div>
                <div className="dmb-drawer-body">
                    {state.error && !data && (
                        <p className="dmb-empty">{t("discord.members.drawer.loadError", { message: state.error.message })}</p>
                    )}
                    {!data && !state.error && <RaidLoader compact text={t("discord.members.drawer.loading")} />}
                    {/* an account that is not on the server: 200 with gone, member null */}
                    {data && (data.gone || !data.member) && <p className="dmb-empty">{t("discord.members.drawer.gone")}</p>}
                    {data && !data.gone && data.member && <Detail data={data} member={data.member} />}
                </div>
            </aside>
        </>
    );
}

function Detail({ data, member }: { data: ServerMemberDetail; member: ServerMember }) {
    const t = useT();
    return (
        <>
            <section className="dmb-sec">
                <div className="dmb-sec-head"><h3>{t("discord.members.drawer.rolesCount", { count: data.roles.length })}</h3></div>
                {data.roles.length === 0 ? <p className="dmb-empty">{t("discord.members.drawer.rolesNone")}</p> : (
                    <ul className="dmb-rolelist">
                        {data.roles.map((r) => {
                            const colour = roleColorVars("dmb", r.color);
                            return (
                                <li key={r.id} className={`dmb-role${colour ? " dmb-coloured" : ""}`} style={colour as CSSProperties | undefined}>
                                    <span className="dmb-dot" aria-hidden="true" />{r.name}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
            <Characters member={member} />
            <Channels groups={data.channels} />
        </>
    );
}

function Characters({ member }: { member: ServerMember }) {
    const t = useT();
    return (
        <section className="dmb-sec">
            <div className="dmb-sec-head"><h3>{t("discord.members.drawer.charactersCount", { count: member.characters.length })}</h3></div>
            {member.characters.length === 0 ? <p className="dmb-empty">{t("discord.members.drawer.charactersNone")}</p> : (
                <table className="dmb-chars">
                    <thead>
                        <tr><th>{t("discord.members.drawer.character")}</th><th>{t("discord.members.drawer.version")}</th><th>{t("discord.members.drawer.roster")}</th></tr>
                    </thead>
                    <tbody>
                        {member.characters.map((c) => {
                            const rosters = rostersOfCharacter(member, c);
                            return (
                                <tr key={`${c.name}-${c.versionId}`}>
                                    <td><span {...classColorProps(classColorOf(c.className))}>{c.name}</span></td>
                                    <td className={c.versionId ? undefined : "dmb-muted"}>{versionShort(c.versionId) || "–"}</td>
                                    <td>
                                        {rosters.length === 0 ? <span className="dmb-muted">–</span> : rosters.map((r) => (
                                            <span key={r.id} className="dmb-croster">{r.name} <span className="dmb-muted">{t(`roster.status.${r.status}`)}</span></span>
                                        ))}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {member.missingRosters.length > 0 && (
                <p className="dmb-missing dmb-missing-line">
                    {t("discord.members.cell.missingSub", { rosters: member.missingRosters.map((r) => r.name).join(", ") })}
                </p>
            )}
        </section>
    );
}

function Channels({ groups }: { groups: MemberChannelGroup[] }) {
    const t = useT();
    const visible = groups.reduce((n, g) => n + g.visible, 0);
    const total = groups.reduce((n, g) => n + g.total, 0);
    const name = (c: MemberChannel) => (c.kind === "voice" ? `${t("discord.members.drawer.voice")}: ${c.name}` : c.kind === "forum" ? `${t("discord.members.drawer.forum")}: ${c.name}` : `#${c.name}`);
    return (
        <section className="dmb-sec">
            <div className="dmb-sec-head">
                <h3>{t("discord.members.drawer.channels")}</h3>
                <span className="dmb-note">{t("discord.members.drawer.channelsCount", { visible, total })}</span>
            </div>
            {groups.length === 0 ? <p className="dmb-empty">{t("discord.members.drawer.channelsNone")}</p> : (
                <div className="dmb-groups">
                    {groups.map((g) => (
                        <details key={g.id || "-"} className={`dmb-group${g.visible ? "" : " dmb-muted"}`}>
                            <summary>
                                <span className="dmb-gname">{g.name || t("discord.members.drawer.noCategory")}</span>
                                <span className="dmb-note">{t("discord.members.drawer.channelsCount", { visible: g.visible, total: g.total })}</span>
                            </summary>
                            {g.channels.length > 0 && (
                                <ul className="dmb-chlist">
                                    {g.channels.map((c) => <li key={c.id}>{name(c)}</li>)}
                                </ul>
                            )}
                        </details>
                    ))}
                </div>
            )}
            <p className="dmb-note">{t("discord.members.drawer.channelsFoot")}</p>
        </section>
    );
}
