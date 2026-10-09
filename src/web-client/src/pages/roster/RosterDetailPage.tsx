// One raid roster (#654, epic "Roster je Kategorie", design canvas artboard 2):
// its head (version and raids, main role, places, attendance) and its tabs —
// only "Mitglieder" so far; Komposition, Abgleich, Anwesenheit and Verlauf
// join the TABS list with their phases. Read only: adding and editing members
// comes with #655, giving the Discord role with #656.
//
// The members table is grouped by status (Stamm, Probe, Ersatz, Pause),
// filtered by square status fields, the role and a search, and sorted by its
// column heads within each group. Names, characters, roles and attendance come
// from the server (GET /api/rosters/roster).
import { useMemo, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { getRosterDetail, type RosterDetail, type RosterMember, type RosterMemberChar, type RosterStatus } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePageCrumb } from "../../hooks/usePageCrumb";
import { tParts, useT } from "../../i18n";
import { BackButton, Badge, IconTile, Segment, WowIcon } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { SortTh } from "../../components/ui/SortTh";
import { AlertIcon, CheckIcon, SearchIcon } from "../../components/ui/icons";
import { AttendanceBar, RoleBadge } from "../../components/roster/RosterCommon";
import { classLabel, roleLabel, specLabel } from "../../lib/wow/wowNames";
import { wowIconUrl } from "../../lib/wow/wowIcon";
import { formatDate } from "../../lib/format";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort } from "../../lib/ui/tableSort";
import {
    MEMBER_SORT_DEFAULTS, MEMBER_VIEW_DEFAULT, ROLE_ICONS, STATUS_ORDER,
    filterMembers, groupByStatus, initialOf, readMemberView, sortMembers, statusCounts,
    type MemberRoleFilter, type MemberSortKey, type MemberView,
} from "../../lib/roster/rosters";
import { RoleChip, VersionLine } from "./RosterParts";
import "../../styles/roster-character.css";
import "../../styles/rosters.css";

/** The roster's tabs; a later phase adds its own line here (and its route segment). */
type TabId = "members";
const TABS: { id: TabId; icon: string; label: string }[] = [
    { id: "members", icon: "achievement_guildperk_everybodysfriend", label: "roster.detail.tabMembers" },
];

const COLUMNS = 6;

function Avatar({ member }: { member: RosterMember }) {
    const color = member.chars[0]?.classColor || "";
    if (member.avatarUrl) return <img className="rn-ava" src={member.avatarUrl} alt="" loading="lazy" />;
    return <span className="rn-ava" style={color ? { "--av": color } as CSSProperties : undefined} aria-hidden="true">{initialOf(member.displayName)}</span>;
}

/** One character chip: spec icon, the name in class colour; the first one emphasised, the others muted. */
function CharChip({ char, first }: { char: RosterMemberChar; first: boolean }) {
    const t = useT();
    const icon = char.specIcon ? wowIconUrl(char.specIcon, 36) : char.iconUrl;
    const cls = classLabel(char.className, char.className);
    const spec = char.specId ? specLabel(char.specId, char.specLabel) : "";
    return (
        <span
            className={`rn-char${first ? " is-first" : " is-alt"}`}
            style={char.classColor ? { "--cc": char.classColor } as CSSProperties : undefined}
            data-tip={spec ? t("roster.detail.charTip", { class: cls, spec }) : cls || char.name}
            data-tip-sub={first ? t("roster.detail.firstChar") : t("roster.detail.otherChar")}
        >
            {icon ? <img src={icon} alt="" width={22} height={22} loading="lazy" /> : <span className="rn-char-ph" aria-hidden="true" />}
            <em className={char.classColor ? "class-colored" : undefined}>{char.name}</em>
        </span>
    );
}

/** Whether the person holds the roster's Discord role — a word, not an action (that comes with #656). */
function DiscordRoleCell({ member, hasRoles }: { member: RosterMember; hasRoles: boolean }) {
    const t = useT();
    if (member.hasRole === true) return <span className="rn-ok"><CheckIcon />{t("roster.detail.hasRole")}</span>;
    if (member.hasRole === false && member.onServer === false) {
        return <span className="rn-warn" data-tip={t("roster.detail.notOnServer")} data-tip-sub={t("roster.detail.notOnServerSub")}><AlertIcon />{t("roster.detail.notOnServer")}</span>;
    }
    if (member.hasRole === false) {
        return <span className="rn-warn" data-tip={t("roster.detail.missingRole")} data-tip-sub={t("roster.detail.missingRoleSub")}><AlertIcon />{t("roster.detail.missingRole")}</span>;
    }
    return (
        <span className="rn-sub" data-tip={t("roster.detail.roleUnknown")} data-tip-sub={hasRoles ? t("roster.detail.roleUnknownSub") : t("roster.detail.noRoleSet")}>
            {t("roster.detail.roleUnknown")}
        </span>
    );
}

function MemberRow({ member, data }: { member: RosterMember; data: RosterDetail }) {
    const t = useT();
    const since = member.since ? formatDate(Date.parse(member.since)) : "";
    return (
        <tr>
            <td>
                <div className="rn-person">
                    <Avatar member={member} />
                    <b>{member.displayName}</b>
                </div>
            </td>
            <td>
                <div className="rn-chars">
                    {member.chars.map((c, i) => <CharChip key={c.key} char={c} first={i === 0} />)}
                    {!member.chars.length && <span className="rn-warn"><AlertIcon />{t("roster.detail.noChar")}</span>}
                </div>
            </td>
            <td><RoleBadge role={member.role} /></td>
            <td><DiscordRoleCell member={member} hasRoles={!!data.roster.discordRoles.length} /></td>
            <td><AttendanceBar attendance={member.attendance ?? undefined} categoryName={data.roster.categoryName || data.roster.name} /></td>
            <td>
                {since && <span className="rn-sub">{t("roster.detail.sinceDate", { date: since })}</span>}
                {member.status === "trial" && member.trialUntil && (
                    <span className="rn-sub rn-until">{t("roster.detail.trialUntil", { date: formatDate(Date.parse(member.trialUntil)) })}</span>
                )}
            </td>
        </tr>
    );
}

/** The square status fields: one per status with its count, each a toggle. */
function StatusFields({ counts, view, onToggle }: { counts: Record<RosterStatus, number>; view: MemberView; onToggle: (s: RosterStatus) => void }) {
    const t = useT();
    return (
        <div className="rn-states" role="group" aria-label={t("roster.detail.statusAria")}>
            {STATUS_ORDER.map((s) => {
                const on = view.statuses.includes(s);
                return (
                    <button
                        key={s}
                        type="button"
                        className={`rn-state${on ? " is-on" : ""}`}
                        data-st={s}
                        aria-pressed={on}
                        data-tip={t(`roster.statusSub.${s}`)}
                        data-tip-sub={on ? t("roster.detail.statusOn") : t("roster.detail.statusOff")}
                        onClick={() => onToggle(s)}
                    >
                        <i aria-hidden="true" />{t(`roster.status.${s}`)} <b>{counts[s]}</b>
                    </button>
                );
            })}
        </div>
    );
}

function MembersTab({ data }: { data: RosterDetail }) {
    const t = useT();
    const [stored, setView] = usePersistedState<MemberView>("roster-members-view", MEMBER_VIEW_DEFAULT);
    const view = readMemberView(stored);
    const patch = (p: Partial<MemberView>) => setView(() => ({ ...view, ...p }));
    const { sort, dir, onSort } = useTableSort<MemberSortKey>("roster-members-sort", MEMBER_SORT_DEFAULTS, "name");
    const counts = useMemo(() => statusCounts(data.members), [data.members]);
    const groups = groupByStatus(sortMembers(filterMembers(data.members, view), sort, dir));
    const toggle = (s: RosterStatus) => patch({ statuses: view.statuses.includes(s) ? view.statuses.filter((x) => x !== s) : [...view.statuses, s] });
    const window = data.window || 0;
    const th = (key: MemberSortKey, label: string, sub?: string) => (
        <SortTh sortKey={key} label={label} sort={sort} dir={dir} onSort={onSort} tip={sub ? label : undefined} tipSub={sub} />
    );

    return (
        <div className="rn-panel rn-members">
            <div className="rn-toolbar">
                <StatusFields counts={counts} view={view} onToggle={toggle} />
                <Segment<MemberRoleFilter>
                    ariaLabel={t("roster.detail.roleAria")}
                    value={view.role}
                    onChange={(role) => patch({ role })}
                    options={[
                        { value: "all", label: t("common.all") },
                        { value: "tank", label: roleLabel("tank"), icon: ROLE_ICONS.tank },
                        { value: "healer", label: roleLabel("healer"), icon: ROLE_ICONS.healer },
                        { value: "dps", label: roleLabel("dps"), icon: ROLE_ICONS.dps },
                    ]}
                />
                <label className="ros-search rn-search">
                    <SearchIcon />
                    <input
                        type="search"
                        placeholder={t("roster.detail.searchPlaceholder")}
                        aria-label={t("roster.detail.searchAria")}
                        value={view.search}
                        onChange={(e) => patch({ search: e.target.value })}
                    />
                </label>
            </div>
            {!data.members.length && <p className="rn-empty">{t("roster.detail.empty")}</p>}
            {!!data.members.length && !groups.length && <p className="rn-empty">{t("roster.detail.noMatch")}</p>}
            {!!groups.length && (
                <div className="rn-tbl-wrap">
                    <table className="rn-tbl">
                        <thead>
                            <tr>
                                {th("name", t("roster.detail.colPerson"))}
                                {th("chars", t("roster.detail.colChars"), t("roster.detail.colCharsSub"))}
                                {th("role", t("roster.detail.colRole"), t("roster.detail.colRoleSub"))}
                                {th("discord", t("roster.detail.colDiscord"), t("roster.detail.colDiscordSub"))}
                                {th("attendance", t("roster.detail.colAttendance"), window ? t("roster.detail.colAttendanceSub", { count: window }) : t("roster.detail.noAttendanceSub"))}
                                {th("since", t("roster.detail.colSince"), t("roster.detail.colSinceSub"))}
                            </tr>
                        </thead>
                        {groups.map((g) => (
                            <tbody key={g.status}>
                                <tr className="rn-grp">
                                    <td colSpan={COLUMNS}>
                                        <span className="rn-st" data-st={g.status}><i aria-hidden="true" />{t(`roster.status.${g.status}`)}</span>
                                        <span className="rn-sub">{t("roster.detail.groupCount", { count: g.rows.length })}</span>
                                    </td>
                                </tr>
                                {g.rows.map((m) => <MemberRow key={m.userId} member={m} data={data} />)}
                            </tbody>
                        ))}
                    </table>
                </div>
            )}
        </div>
    );
}

function RosterHeadBlock({ data, tab }: { data: RosterDetail; tab: TabId }) {
    const t = useT();
    const r = data.roster;
    const line = [
        r.slots.total > 0 ? t("roster.detail.places", { places: r.places, total: r.slots.total }) : t("roster.detail.placesNoTarget", { count: r.places }),
    ];
    if (r.attendance !== null) line.push(t("roster.detail.attendance", { pct: r.attendance }));
    return (
        <>
            <div className="rn-head">
                <IconTile icon={r.icon} tone="roster" size="lg" />
                <div className="rn-head-text">
                    <VersionLine versionId={r.versionId} parts={[r.versionLabel, ...(r.categoryId ? r.contents : [t("roster.overview.noCategory")])]} />
                    <h1 className="rn-h1">{r.name}</h1>
                    <div className="rn-head-meta">
                        <RoleChip role={r.mainRole} />
                        <span className="rn-sub">{line.join(" · ")}</span>
                    </div>
                </div>
            </div>
            <nav className="rn-tabs" aria-label={t("roster.detail.tabsAria")}>
                {TABS.map((tb) => (
                    <Link
                        key={tb.id}
                        className={`rn-tab${tb.id === tab ? " is-on" : ""}`}
                        to={`/roster/r/${encodeURIComponent(r.id)}`}
                        aria-current={tb.id === tab ? "page" : undefined}
                    >
                        <WowIcon name={tb.icon} size={20} />
                        {t(tb.label)}
                        <Badge count>{r.members}</Badge>
                    </Link>
                ))}
            </nav>
        </>
    );
}

export default function RosterDetailPage() {
    const t = useT();
    const { rosterId = "" } = useParams();
    const state = useApi(() => getRosterDetail(rosterId), [rosterId]);
    usePageCrumb(state.data?.roster.name ?? null);
    const back = <BackButton to="/roster" label={t("roster.detail.back")} size="sm" className="rn-back" />;

    if (state.error) {
        return (
            <div className="rn-page">
                {back}
                <p className="rn-empty">
                    {state.error.code === "not_found" ? t("roster.detail.notFound") : tParts("roster.detail.loadError", { message: state.error.message })}
                </p>
            </div>
        );
    }
    if (!state.data) return <RaidLoader text={t("roster.detail.loading")} />;
    return (
        <div className="rn-page">
            {back}
            <RosterHeadBlock data={state.data} tab="members" />
            <MembersTab data={state.data} />
        </div>
    );
}
