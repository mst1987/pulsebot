import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getServerMembers, type MemberRole, type ServerMember, type ServerMembers } from "../../api";
import { getVermerke, type VermerkPerson } from "../../api/roster/vermerke";
import { useApi } from "../../hooks/useApi";
import type { ShellContext } from "../../components/shell/Shell";
import { Badge, Button, PageHead, Switch } from "../../components/ui";
import { SortTh } from "../../components/ui/table/SortTh";
import { PlusIcon, SearchIcon } from "../../components/ui/icons/icons";
import LevelMark from "../../components/vermerke/LevelMark";
import VermerkDialog, { type VermerkDialogPreset } from "../../components/vermerke/VermerkDialog";
import { canAccess } from "../../lib/app/access";
import { classColorProps } from "../../components/character/ClassSpec";
import DiscordTabs from "../../components/channels/DiscordTabs";
import ServerPicker from "../../components/channels/ServerPicker";
import { pickSearch, useServerPick } from "../../hooks/useServerPick";
import RaidLoader from "../../components/ui/layout/RaidLoader";
import { useTableSort, type TableSort } from "../../lib/ui/tableSort";
import { initialsOf } from "../../lib/discord/serverRoles";
import {
    MEMBER_SORT_DEFAULTS, NO_FILTER, classColorOf, filterCounts, filterMembers, joinedDate, memberSortValue,
    memberFromQuery, rosterView, splitRoles, type MemberFilter, type MemberSortKey,
} from "../../lib/discord/members";
import { roleColorVars } from "../../lib/discord/roleColor";
import MemberDrawer from "./MemberDrawer";
import "../../styles/discord-members.css";
import { useT } from "../../i18n";

// System › Discord › Mitglieder (docs/channels.md): everyone on one server of the
// server list (picker in the controls, #895) with their roles in the role colour, since when they are there and
// how they are tied to the raids — the character in its class colour and the
// roster, or "nicht im Roster". A search (name, Discord name, character), a role
// filter and three switches narrow it down; bots are hidden unless asked for. A
// role of a roster without being in it is marked orange. A click on a row opens
// the member in a drawer (`?user=<id>` opens it from a link, `&guild=<id>` beyond
// the first server). Display only —
// roles are given in Discord and in the roster.

/** Rows before "alle zeigen". */
const ROWS_SHOWN = 50;

export default function MembersPage() {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    const [params, setParams] = useSearchParams();
    const pick = useServerPick();
    const guildId = pick.guildId;
    const [filter, setFilter] = useState<MemberFilter>(NO_FILTER);
    const state = useApi(() => getServerMembers(guildId), [guildId], { enabled: pick.ready });
    const sort = useTableSort<MemberSortKey>("discord-members-sort", MEMBER_SORT_DEFAULTS, "name");
    const data = state.data && (!guildId || state.data.guildId === guildId) ? state.data : null;
    const openId = params.get("user");
    const navigate = useNavigate();
    // Vermerke (#980): the notes of the active server, for the "Mit Vermerk" filter
    // and the mark next to the name — only when the picked server is that one
    const canReadNotes = canAccess(user, "vermerke", "read");
    const canWriteNotes = canAccess(user, "vermerke", "write");
    const notesState = useApi(() => getVermerke(), [], { enabled: canReadNotes });
    const [withNote, setWithNote] = useState(false);
    const [dialog, setDialog] = useState<VermerkDialogPreset | null>(null);
    const notesById = useMemo(() => {
        const list = notesState.data;
        if (!list || !data || list.guildId !== data.guildId) return null;
        return new Map(list.people.filter((p) => p.activeCount > 0).map((p) => [p.userId, p]));
    }, [notesState.data, data]);
    // a role filter belongs to its server
    useEffect(() => setFilter((f) => (f.roleId ? { ...f, roleId: "" } : f)), [guildId]);

    const query = (id: string | null) => ({ ...(id ? { user: id } : {}), ...pick.param(guildId) });
    // opening a member is a step back can undo (push); closing and switching the server replace it
    const open = (id: string) => setParams(query(id));
    const close = () => setParams(query(null), { replace: true });
    const sideSegment = <ServerPicker pick={pick} drop={["user"]} />;
    const listed = data ? memberFromQuery(data.members, openId) : null;

    return (
        <div className="dmb-page">
            <PageHead
                icon="members" tone="channels"
                kicker={data && data.guildName ? `${t("discord.members.page.kicker")} · ${data.guildName}` : t("discord.members.page.kicker")}
                title={t("discord.members.page.title")}
                meta={data ? <HeadBadges data={data} /> : undefined}
            />
            <DiscordTabs user={user} guildId={guildId} search={pickSearch(pick)} />

            {state.error && !data && <p className="empty">{t("discord.members.page.loadError", { message: state.error.message })}</p>}
            {!data && !state.error && <><div className="dmb-controls">{sideSegment}</div><RaidLoader text={t("discord.members.page.loading")} /></>}
            {data && (
                <MembersView
                    data={data} sideSegment={sideSegment} filter={filter} setFilter={setFilter} sort={sort} openId={openId} onOpen={open}
                    notesById={notesById} withNote={withNote} setWithNote={setWithNote}
                />
            )}
            {/* no drawer while no server is set up */}
            {data && data.guildId && openId && (
                <MemberDrawer
                    guildId={data.guildId} userId={openId} guildName={data.guildName} listed={listed} onClose={close}
                    actions={notesById && (
                        <>
                            {canWriteNotes && (
                                <Button
                                    variant="ghost" size="sm" icon={<PlusIcon />} data-tip={t("vermerke.members.add")} data-tip-sub={t("vermerke.members.addSub")}
                                    onClick={() => setDialog({ person: { userId: openId, name: listed ? listed.name : openId } })}
                                >
                                    {t("vermerke.members.add")}
                                </Button>
                            )}
                            {notesById.has(openId) && (
                                <Button variant="ghost" size="sm" onClick={() => navigate(`/vermerke?user=${encodeURIComponent(openId)}`)}>
                                    {t("vermerke.members.open")}
                                </Button>
                            )}
                        </>
                    )}
                />
            )}
            {dialog && (
                <VermerkDialog guildId={data ? data.guildId : ""} preset={dialog} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); notesState.reload(); }} />
            )}
        </div>
    );
}

/** What the head says about the server: how many members, and what keeps the page from being complete. */
function HeadBadges({ data }: { data: ServerMembers }) {
    const t = useT();
    if (!data.guildId) return null;
    if (!data.online) return <Badge tone="bad" tip={t("discord.members.page.offline")} tipSub={t("discord.members.page.offlineSub")}>{t("discord.members.page.offline")}</Badge>;
    if (data.membersError) return <Badge tone="mid" tip={t("discord.members.page.membersError")} tipSub={membersErrorText(data, t)}>{t("discord.members.page.membersError")}</Badge>;
    // people, like the list below with its bots hidden
    return <Badge>{t("discord.members.page.count", { count: data.members.filter((m) => !m.bot).length })}</Badge>;
}

/** Why the list is missing: Discord was too slow, or it does not hand the list out at all (the GuildMembers intent). */
function membersErrorText(data: ServerMembers, t: ReturnType<typeof useT>): string {
    return t(data.membersError === "timeout" ? "discord.members.page.membersErrorSub" : "discord.members.page.membersErrorIntent");
}

function MembersView({ data, sideSegment, filter, setFilter, sort, openId, onOpen, notesById, withNote, setWithNote }: {
    data: ServerMembers;
    sideSegment: ReactNode;
    filter: MemberFilter;
    setFilter: (f: MemberFilter) => void;
    sort: TableSort<MemberSortKey>;
    openId: string | null;
    onOpen: (id: string) => void;
    /** the people with notes that count on this server, null without the right or for another server */
    notesById: Map<string, VermerkPerson> | null;
    withNote: boolean;
    setWithNote: (on: boolean) => void;
}) {
    const t = useT();
    const [all, setAll] = useState(false);
    const rolesById = useMemo(() => new Map(data.roles.map((r) => [r.id, r])), [data.roles]);
    const counts = filterCounts(data.members, filter.hideBots);
    const patch = (p: Partial<MemberFilter>) => { setFilter({ ...filter, ...p }); setAll(false); };
    const noteFilter = !!notesById && withNote;
    const noteCount = notesById ? data.members.filter((m) => notesById.has(m.id)).length : 0;
    const ready = data.guildId && data.online && !data.membersError;

    const controls = (
        <div className="dmb-controls">
            {sideSegment}
            {ready && (
                <>
                    <label className="dmb-search">
                        <SearchIcon />
                        <input
                            type="search" value={filter.query} onChange={(e) => patch({ query: e.target.value })}
                            placeholder={t("discord.members.page.search")} aria-label={t("discord.members.page.search")}
                        />
                    </label>
                    <select className="dmb-role-select" value={filter.roleId} onChange={(e) => patch({ roleId: e.target.value })} aria-label={t("discord.members.page.role")}>
                        <option value="">{t("discord.members.page.allRoles")}</option>
                        {data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </>
            )}
        </div>
    );
    const switches = ready && (
        <div className="dmb-switches">
            <Switch
                checked={filter.noRole} onChange={(on) => patch({ noRole: on })}
                label={<>{t("discord.members.page.noRole")} <span className="dmb-n">{counts.noRole}</span></>}
                tipHead={t("discord.members.page.noRole")} tip={t("discord.members.page.noRoleSub")}
            />
            <Switch
                checked={filter.notInRoster} onChange={(on) => patch({ notInRoster: on })}
                label={<>{t("discord.members.page.notInRoster")} <span className="dmb-n">{counts.notInRoster}</span></>}
                tipHead={t("discord.members.page.notInRoster")} tip={t("discord.members.page.notInRosterSub")}
            />
            <Switch
                checked={filter.hideBots} onChange={(on) => patch({ hideBots: on })}
                label={<>{t("discord.members.page.hideBots")} <span className="dmb-n">{counts.bots}</span></>}
                tipHead={t("discord.members.page.hideBots")} tip={t("discord.members.page.hideBotsSub")}
            />
            {notesById && (
                <Switch
                    checked={withNote} onChange={(on) => { setWithNote(on); setAll(false); }}
                    label={<>{t("vermerke.members.filter")} <span className="dmb-n">{noteCount}</span></>}
                    tipHead={t("vermerke.members.filter")} tip={t("vermerke.members.filterSub")}
                />
            )}
        </div>
    );

    if (!data.guildId) return <>{controls}<p className="empty">{t("discord.server.none")}</p></>;
    if (!data.online) return <>{controls}<p className="empty">{t("discord.members.page.offlineSub")}</p></>;
    if (data.membersError) return <>{controls}<p className="empty">{membersErrorText(data, t)}</p></>;

    const filtered = filterMembers(data.members, filter);
    const kept = noteFilter && notesById ? filtered.filter((m) => notesById.has(m.id)) : filtered;
    const rows = sort.apply(kept, (m, key) => memberSortValue(m, key, rolesById));
    const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
    const pool = filter.hideBots ? data.members.filter((m) => !m.bot).length : data.members.length;
    // without a search or filter: how many, and how many bots are left out; with one: "N von M"
    const narrowed = !!(filter.query.trim() || filter.roleId || filter.noRole || filter.notInRoster || noteFilter);
    const note = narrowed
        ? t("discord.members.page.shown", { count: rows.length, total: pool })
        : [t("discord.members.page.count", { count: rows.length }), filter.hideBots && counts.bots > 0 ? t("discord.members.page.botsHidden", { count: counts.bots }) : ""].filter(Boolean).join(" · ");

    return (
        <>
            {controls}
            {switches}
            {data.members.length === 0 ? <p className="empty">{t("discord.members.page.empty")}</p> : rows.length === 0 ? (
                <p className="empty">{t("discord.members.page.emptyFilter")}</p>
            ) : (
                <>
                    <p className="dmb-note">{note}</p>
                    <div className="dmb-wrap">
                        <table className="idx dmb-table">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label={t("discord.members.col.member")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                                    <SortTh sortKey="roles" label={t("discord.members.col.roles")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} className="dmb-c-roles" />
                                    <SortTh sortKey="joined" label={t("discord.members.col.joined")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={t("discord.members.col.joinedTip")} className="dmb-c-joined" />
                                    <SortTh
                                        sortKey="roster"
                                        label={<><span className="dmb-long">{t("discord.members.col.roster")}</span><span className="dmb-short">{t("discord.members.col.rosterShort")}</span></>}
                                        sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={t("discord.members.col.roster")} className="dmb-c-roster"
                                    />
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map((m) => (
                                    <MemberRow
                                        key={m.id} member={m} rolesById={rolesById} open={m.id === openId} onOpen={onOpen}
                                        note={notesById ? notesById.get(m.id) || null : null}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {rows.length > shown.length && (
                        <button type="button" className="dmb-more" onClick={() => setAll(true)}>
                            {t("discord.members.page.showAll", { count: rows.length - shown.length })}
                        </button>
                    )}
                </>
            )}
            <p className="dmb-foot">{t("discord.members.page.footnote")}</p>
        </>
    );
}

function MemberRow({ member: m, rolesById, open, onOpen, note }: {
    member: ServerMember;
    rolesById: Map<string, MemberRole>;
    open: boolean;
    onOpen: (id: string) => void;
    /** the member's notes on this server (the level as a symbol next to the name) */
    note: VermerkPerson | null;
}) {
    const t = useT();
    const joined = joinedDate(m.joinedAt);
    return (
        <tr className={`dmb-row${open ? " dmb-open" : ""}`} onClick={() => onOpen(m.id)}>
            <td className="dmb-c-member">
                <div className="dmb-who">
                    <span className="dmb-av" aria-hidden="true">{m.avatarUrl ? <img src={m.avatarUrl} alt="" loading="lazy" /> : initialsOf(m.name)}</span>
                    <span className="dmb-names">
                        <button type="button" className="dmb-name" onClick={(e) => { e.stopPropagation(); onOpen(m.id); }} aria-expanded={open}>{m.name}</button>
                        {note && note.level && <LevelMark level={note.level} iconOnly size={15} />}
                        {m.bot && <span className="dmb-tag">{t("discord.members.cell.bot")}</span>}
                        {m.username && m.username !== m.name.toLowerCase() && <span className="dmb-user">{m.username}</span>}
                        {/* phone: the roster and the highest role under the name, the columns are hidden there */}
                        <span className="dmb-meta">
                            <RosterCell member={m} />
                            {m.roleIds.length > 0 && <Roles roleIds={m.roleIds} rolesById={rolesById} max={1} />}
                        </span>
                    </span>
                </div>
            </td>
            <td className="dmb-c-roles">
                {m.roleIds.length === 0 ? <span className="dmb-muted">{t("discord.members.cell.noRole")}</span> : <Roles roleIds={m.roleIds} rolesById={rolesById} max={3} />}
            </td>
            <td className={`dmb-c-joined${joined ? "" : " dmb-muted"}`}>{joined || t("discord.members.cell.unknown")}</td>
            <td className="dmb-c-roster"><RosterCell member={m} /></td>
        </tr>
    );
}

function Roles({ roleIds, rolesById, max }: { roleIds: string[]; rolesById: Map<string, MemberRole>; max: number }) {
    const t = useT();
    const { shown, more } = splitRoles(roleIds, rolesById, max);
    return (
        <span className="dmb-roles">
            {shown.map((r) => {
                const colour = roleColorVars("dmb", r.color);
                return (
                    <span key={r.id} className={`dmb-role${colour ? " dmb-coloured" : ""}`} style={colour as CSSProperties | undefined}>
                        <span className="dmb-dot" aria-hidden="true" />{r.name}
                    </span>
                );
            })}
            {more.length > 0 && (
                <span className="dmb-morer" data-tip={t("discord.members.cell.moreTip", { count: more.length })} data-tip-sub={more.map((r) => r.name).join(", ")}>
                    {t("discord.members.cell.more", { count: more.length })}
                </span>
            )}
        </span>
    );
}

/** The character in its class colour and the roster — or "nicht im Roster"; orange when a roster role has no roster behind it. */
function RosterCell({ member: m }: { member: ServerMember }) {
    const t = useT();
    if (m.bot) return null;
    const view = rosterView(m);
    const missing = m.missingRosters.length > 0 && (
        <span
            className="dmb-missing"
            data-tip={t("discord.members.cell.missing")}
            data-tip-sub={t("discord.members.cell.missingSub", { rosters: m.missingRosters.map((r) => r.name).join(", ") })}
        >
            {t("discord.members.cell.missing")}
        </span>
    );
    if (view.kind === "none") return <span className="dmb-rost"><span className="dmb-muted">{t("discord.members.cell.noCharacter")}</span>{missing}</span>;
    const char = view.character;
    const charEl = char && <span {...classColorProps(classColorOf(char.className))}>{char.name}</span>;
    if (view.kind === "outside") return <span className="dmb-rost">{charEl}<span className="dmb-muted">{t("discord.members.cell.outside")}</span>{missing}</span>;
    return (
        <span className="dmb-rost">
            {charEl}
            <span className="dmb-rname">{view.roster.name}</span>
            {view.more > 0 && <span className="dmb-muted">{t("discord.members.cell.rosterMore", { count: view.more })}</span>}
            {missing}
        </span>
    );
}
