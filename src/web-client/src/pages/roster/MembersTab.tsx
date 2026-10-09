// The members tab of a roster (#654, editing #655/#656): grouped by status,
// filtered by the square status fields, the role and a search, sorted by the
// column heads within each group. A name opens the member drawer for everyone
// (read only without the right to manage); a manager gets "Bearbeiten" per row
// and "Rolle geben" where the Discord role is missing.
import { useMemo } from "react";
import type { RosterDetail, RosterMember, RosterStatus } from "../../api";
import { useT } from "../../i18n";
import { Button, Segment } from "../../components/ui";
import { SortTh } from "../../components/ui/SortTh";
import { AlertIcon, CheckIcon, EditIcon, SearchIcon } from "../../components/ui/icons";
import { AttendanceBar, RoleBadge } from "../../components/roster/RosterCommon";
import { roleLabel } from "../../lib/wow/wowNames";
import { formatDate } from "../../lib/format";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort } from "../../lib/ui/tableSort";
import {
    MEMBER_SORT_DEFAULTS, MEMBER_VIEW_DEFAULT, ROLE_ICONS, STATUS_ORDER,
    filterMembers, groupByStatus, readMemberView, sortMembers, statusCounts,
    type MemberRoleFilter, type MemberSortKey, type MemberView,
} from "../../lib/roster/rosters";
import { CharChip, MemberAvatar } from "./RosterParts";

type RowActions = {
    canManage: boolean;
    busy: string;
    onOpen: (userId: string) => void;
    onGiveRole: (member: RosterMember) => void;
};

/** Whether the person holds the roster's Discord role; a manager can give a missing one right here. */
function DiscordRoleCell({ member, hasRoles, actions }: { member: RosterMember; hasRoles: boolean; actions: RowActions }) {
    const t = useT();
    if (member.hasRole === true) return <span className="rn-ok"><CheckIcon />{t("roster.detail.hasRole")}</span>;
    if (member.hasRole === false && member.onServer === false) {
        return <span className="rn-warn" data-tip={t("roster.detail.notOnServer")} data-tip-sub={t("roster.detail.notOnServerSub")}><AlertIcon />{t("roster.detail.notOnServer")}</span>;
    }
    if (member.hasRole === false) {
        return (
            <span className="rn-role-cell">
                <span className="rn-warn" data-tip={t("roster.detail.missingRole")} data-tip-sub={actions.canManage ? t("roster.detail.missingRoleManage") : t("roster.detail.missingRoleSub")}>
                    <AlertIcon />{t("roster.detail.missingRole")}
                </span>
                {actions.canManage && (
                    <Button size="sm" variant="run" running={actions.busy === `role-${member.userId}`} onClick={() => actions.onGiveRole(member)}>
                        {t("roster.detail.giveRole")}
                    </Button>
                )}
            </span>
        );
    }
    return (
        <span className="rn-sub" data-tip={t("roster.detail.roleUnknown")} data-tip-sub={hasRoles ? t("roster.detail.roleUnknownSub") : t("roster.detail.noRoleSet")}>
            {t("roster.detail.roleUnknown")}
        </span>
    );
}

function MemberRow({ member, data, actions }: { member: RosterMember; data: RosterDetail; actions: RowActions }) {
    const t = useT();
    const since = member.since ? formatDate(Date.parse(member.since)) : "";
    return (
        <tr>
            <td>
                <button type="button" className="rn-person rn-person-btn" onClick={() => actions.onOpen(member.userId)} data-tip={t("roster.detail.openTip")}>
                    <MemberAvatar member={member} />
                    <b>{member.displayName}</b>
                </button>
            </td>
            <td>
                <div className="rn-chars">
                    {member.chars.map((c, i) => <CharChip key={c.key} char={c} first={i === 0} />)}
                    {!member.chars.length && <span className="rn-warn"><AlertIcon />{t("roster.detail.noChar")}</span>}
                </div>
            </td>
            <td><RoleBadge role={member.role} /></td>
            <td><DiscordRoleCell member={member} hasRoles={!!data.roster.discordRoles.length} actions={actions} /></td>
            <td><AttendanceBar attendance={member.attendance ?? undefined} categoryName={data.roster.categoryName || data.roster.name} /></td>
            <td>
                {since && <span className="rn-sub">{t("roster.detail.sinceDate", { date: since })}</span>}
                {member.status === "trial" && member.trialUntil && (
                    <span className="rn-sub rn-until">{t("roster.detail.trialUntil", { date: formatDate(Date.parse(member.trialUntil)) })}</span>
                )}
            </td>
            {actions.canManage && (
                <td className="rn-act-cell">
                    <Button size="sm" variant="ghost" icon={<EditIcon />} onClick={() => actions.onOpen(member.userId)}>{t("roster.detail.edit")}</Button>
                </td>
            )}
        </tr>
    );
}

/** The square status fields: one per status with its count, each a toggle. */
function StatusFilter({ counts, view, onToggle }: { counts: Record<RosterStatus, number>; view: MemberView; onToggle: (s: RosterStatus) => void }) {
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

export default function MembersTab({ data, busy, onOpen, onGiveRole }: { data: RosterDetail } & Omit<RowActions, "canManage">) {
    const t = useT();
    const [stored, setView] = usePersistedState<MemberView>("roster-members-view", MEMBER_VIEW_DEFAULT);
    const view = readMemberView(stored);
    const patch = (p: Partial<MemberView>) => setView(() => ({ ...view, ...p }));
    const { sort, dir, onSort } = useTableSort<MemberSortKey>("roster-members-sort", MEMBER_SORT_DEFAULTS, "name");
    const counts = useMemo(() => statusCounts(data.members), [data.members]);
    const groups = groupByStatus(sortMembers(filterMembers(data.members, view), sort, dir));
    const toggle = (s: RosterStatus) => patch({ statuses: view.statuses.includes(s) ? view.statuses.filter((x) => x !== s) : [...view.statuses, s] });
    const window = data.window || 0;
    const actions: RowActions = { canManage: data.canManage, busy, onOpen, onGiveRole };
    const columns = data.canManage ? 7 : 6;
    const th = (key: MemberSortKey, label: string, sub?: string) => (
        <SortTh sortKey={key} label={label} sort={sort} dir={dir} onSort={onSort} tip={sub ? label : undefined} tipSub={sub} />
    );

    return (
        <div className="rn-panel rn-members">
            <div className="rn-toolbar">
                <StatusFilter counts={counts} view={view} onToggle={toggle} />
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
                    <table className={`rn-tbl${data.canManage ? " has-act" : ""}`}>
                        <thead>
                            <tr>
                                {th("name", t("roster.detail.colPerson"))}
                                {th("chars", t("roster.detail.colChars"), t("roster.detail.colCharsSub"))}
                                {th("role", t("roster.detail.colRole"), t("roster.detail.colRoleSub"))}
                                {th("discord", t("roster.detail.colDiscord"), t("roster.detail.colDiscordSub"))}
                                {th("attendance", t("roster.detail.colAttendance"), window ? t("roster.detail.colAttendanceSub", { count: window }) : t("roster.detail.noAttendanceSub"))}
                                {th("since", t("roster.detail.colSince"), t("roster.detail.colSinceSub"))}
                                {data.canManage && <th />}
                            </tr>
                        </thead>
                        {groups.map((g) => (
                            <tbody key={g.status}>
                                <tr className="rn-grp">
                                    <td colSpan={columns}>
                                        <span className="rn-st" data-st={g.status}><i aria-hidden="true" />{t(`roster.status.${g.status}`)}</span>
                                        <span className="rn-sub">{t("roster.detail.groupCount", { count: g.rows.length })}</span>
                                    </td>
                                </tr>
                                {g.rows.map((m) => <MemberRow key={m.userId} member={m} data={data} actions={actions} />)}
                            </tbody>
                        ))}
                    </table>
                </div>
            )}
        </div>
    );
}
