import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Access, Area, Role, RolePermissions } from "../../api";
import {
    areaCounts, areaDescription, areaLabel, isDiscordId, levelLabel, levelOf, nextLevel, withLevel, type Grants, type Level,
} from "../../lib/settingsLogic";
import { t as translate, useT } from "../../i18n";
import { Button, IconButton } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import Badge from "../../components/ui/Badge";
import Segment from "../../components/ui/Segment";
import PartHead from "../../components/ui/PartHead";
import WowIcon from "../../components/ui/WowIcon";
import { EyeIcon, LockIcon, PlusIcon, TrashIcon, XIcon } from "../../components/icons";
import { PenIcon } from "../../components/settings/settingsUi";
import { FieldLabel, InfoTip } from "../../components/ui/Field";
import { useDismiss } from "../../hooks/useDismiss";

// Einstellungen → Berechtigungen as one matrix: rows = who, columns = the areas
// of the menu, each cell one tri-state button (aus › Lesen › Schreiben). It
// replaces a stack of cards with a table of switches per role — around 160
// switches on seven screens, where two roles could not be compared at all.
//
// Grouped by owner: the full admins (their roles as badges; they get everything),
// the base access every logged-in account gets, the roles, and single accounts.
// All grants are unions — a row only ever widens what someone may do. The stored
// shapes (adminRoleIds, rolePermissions, baseAccess, userPermissions, see
// src/config/permissions.js) do not change; the server normalises them again.

/** The WoW icon of each area's column — the same icons as the shell's menu. */
const AREA_ICONS: Record<string, string> = {
    dashboard: "achievement_zone_outland_01",
    recruitment: "inv_misc_grouplooking",
    cla: "inv_misc_pocketwatch_01",
    raids: "inv_misc_note_02",
    roster: "achievement_guildperk_everybodysfriend",
    history: "inv_misc_book_09",
    loot: "inv_misc_bag_10",
    lootcouncil: "inv_misc_coin_02",
    channels: "inv_letter_15",
    settings: "trade_engineering",
};

type RowKind = "base" | "role" | "user";

/** One tri-state cell. The tooltip names row, area and what the next click does. */
function TriStateCell({ owner, area, level, onSet }: {
    owner: string;
    area: Area;
    level: Level;
    onSet: (level: Level) => void;
}) {
    const t = useT();
    const next = nextLevel(level);
    const name = areaLabel(area);
    return (
        <button
            type="button"
            className={`perm-cell lv-${level}`}
            aria-label={t("settings.permissions.cellAria", { owner, area: name, level: levelLabel(level) })}
            data-tip={`${owner} · ${name}`}
            data-tip-sub={t("settings.permissions.cellSub", { level: levelLabel(level), next: levelLabel(next) })}
            onClick={() => onSet(next)}
        >
            {level === "write" ? <PenIcon /> : level === "read" ? <EyeIcon /> : <span aria-hidden="true">–</span>}
        </button>
    );
}

/** The row head: a click opens the three row-wide actions. */
function RowName({ label, sub, avatar, onAll }: {
    label: string;
    sub: string;
    avatar: ReactNode;
    onAll: (level: Level) => void;
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, open, () => setOpen(false));

    return (
        <div className="perm-who" ref={ref}>
            {avatar}
            <button type="button" className="perm-who-name" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
                data-tip={label} data-tip-sub={t("settings.permissions.rowSub")}>
                <span className="perm-who-label">{label}</span>
                <span className="perm-who-sub">{sub}</span>
            </button>
            {open && (
                <div className="split-menu perm-menu" role="menu">
                    {(["read", "write", "none"] as Level[]).map((lv) => (
                        <button key={lv} type="button" role="menuitem" onClick={() => { setOpen(false); onAll(lv); }}>
                            {lv === "read" ? t("settings.permissions.allRead") : lv === "write" ? t("settings.permissions.allWrite") : t("settings.permissions.allNone")}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function GroupRow({ span, label, tip, tipSub, aside }: { span: number; label: string; tip: string; tipSub: string; aside?: ReactNode }) {
    return (
        <tr className="perm-group">
            <td colSpan={span}>
                <div className="perm-group-head">
                    <span>{label}</span>
                    <InfoTip head={tip} sub={tipSub} />
                    {aside && <span className="perm-group-aside">{aside}</span>}
                </div>
            </td>
        </tr>
    );
}

function grantSummary(areas: Area[], grants: Grants | undefined): string {
    let read = 0;
    let write = 0;
    for (const a of areas) {
        const lv = levelOf(grants?.[a.id]);
        if (lv === "read") read += 1;
        if (lv === "write") write += 1;
    }
    if (!read && !write) return translate("settings.permissions.nothing");
    return translate("settings.permissions.summary", { read, write });
}

export default function RolePermissionsEditor({
    areas, roles, adminRoleIds, onAdminRoleIds, value, onChange, baseAccess, onBaseAccessChange,
    userPermissions, onUserPermissionsChange, userNames, icon, crumb, viewSwitch,
}: {
    /** The Bereiche · Bot-Befehle segment, shown in the part head. */
    viewSwitch?: ReactNode;
    areas: Area[];
    roles: Role[];
    adminRoleIds: string[];
    onAdminRoleIds: (next: string[]) => void;
    value: RolePermissions;
    onChange: (next: RolePermissions) => void;
    baseAccess: Access;
    onBaseAccessChange: (next: Access) => void;
    userPermissions: RolePermissions;
    onUserPermissionsChange: (next: RolePermissions) => void;
    userNames: Record<string, string>;
    icon: string;
    crumb: string;
}) {
    const t = useT();
    const [adding, setAdding] = useState<null | "grant" | "admin">(null);
    const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
    const roleName = (id: string) => (roleById.get(id) ? `@${roleById.get(id)!.name}` : t("settings.permissions.unknownRole", { id }));

    // Configured roles in the guild's role order, then ids the guild no longer
    // has — kept visible so they can be cleaned up instead of lingering unseen.
    const roleIds = [
        ...roles.filter((r) => value[r.id]).map((r) => r.id),
        ...Object.keys(value).filter((id) => !roleById.has(id)),
    ];
    const userIds = Object.keys(userPermissions);
    const span = areas.length + 2;

    const setRole = (roleId: string, grants: Grants) => onChange({ ...value, [roleId]: grants as RolePermissions[string] });
    const setUser = (userId: string, grants: Grants) => onUserPermissionsChange({ ...userPermissions, [userId]: grants as RolePermissions[string] });
    const allOf = (level: Level): Grants => {
        let out: Grants = {};
        for (const a of areas) out = withLevel(out, a.id, level);
        return out;
    };

    const cells = (kind: RowKind, id: string, owner: string, grants: Grants | undefined) => areas.map((area) => (
        <td key={area.id} className="perm-td">
            <TriStateCell
                owner={owner}
                area={area}
                level={levelOf(grants?.[area.id])}
                onSet={(lv) => {
                    const next = withLevel(grants, area.id, lv);
                    if (kind === "base") onBaseAccessChange(next);
                    else if (kind === "role") setRole(id, next);
                    else setUser(id, next);
                }}
            />
        </td>
    ));

    const columnMaps: Grants[] = [baseAccess, ...Object.values(value), ...Object.values(userPermissions)];

    return (
        <>
            <PartHead
                icon={icon}
                tone="settings"
                title={t("settings.sections.berechtigungen.label")}
                crumb={t("settings.crumb", { crumb })}
                action={<>{viewSwitch}<Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setAdding("grant")}>{t("settings.permissions.addOwner")}</Button></>}
            />
            <div className="perm-legend">
                <span className="note">{t("settings.permissions.clickToggles")}</span>
                <span className="perm-cell lv-none" aria-hidden="true"><span>–</span></span><span className="note">{levelLabel("none")}</span>
                <span className="note perm-sep">›</span>
                <span className="perm-cell lv-read" aria-hidden="true"><EyeIcon /></span><span className="note">{levelLabel("read")}</span>
                <span className="note perm-sep">›</span>
                <span className="perm-cell lv-write" aria-hidden="true"><PenIcon /></span><span className="note">{levelLabel("write")}</span>
                <span className="grow" />
                <Badge tone="accent" tip={t("settings.permissions.additiveTip")} tipSub={t("settings.permissions.additiveSub")}>
                    {t("settings.permissions.additive")}
                </Badge>
            </div>

            <div className="perm-card table-scroll">
                <table className="idx perm-matrix">
                    <colgroup>
                        <col className="perm-col-who" />
                        {areas.map((a) => <col key={a.id} className="perm-col" />)}
                        <col className="perm-col-act" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>{t("settings.permissions.who")}</th>
                            {areas.map((a) => {
                                const counts = areaCounts(columnMaps, a.id);
                                return (
                                    <th key={a.id} className="perm-th" data-tip={areaLabel(a)} data-tip-sub={`${areaDescription(a)}\n${t("settings.permissions.columnCounts", { read: counts.read, write: counts.write })}`} tabIndex={0}>
                                        <WowIcon name={AREA_ICONS[a.id] || "inv_misc_questionmark"} size={26} />
                                    </th>
                                );
                            })}
                            <th aria-label={t("settings.permissions.actions")} />
                        </tr>
                    </thead>
                    <tbody>
                        <GroupRow
                            span={span}
                            label={t("settings.permissions.admins")}
                            tip={t("settings.permissions.admins")}
                            tipSub={t("settings.permissions.adminsSub")}
                            aside={<Badge icon={<LockIcon />}>{t("settings.permissions.adminsAside")}</Badge>}
                        />
                        <tr className="perm-admins">
                            <td colSpan={span}>
                                <div className="perm-admin-list">
                                    {adminRoleIds.map((id) => (
                                        <button
                                            key={id}
                                            type="button"
                                            className="badge accent perm-admin-role"
                                            data-tip={t("settings.permissions.removeTip", { name: roleName(id) })}
                                            data-tip-sub={t("settings.permissions.roleId", { id })}
                                            onClick={() => onAdminRoleIds(adminRoleIds.filter((x) => x !== id))}
                                        >
                                            {roleName(id)}<XIcon />
                                        </button>
                                    ))}
                                    <button type="button" className="badge perm-add-admin" onClick={() => setAdding("admin")} disabled={!roles.length}
                                        data-tip={roles.length ? t("settings.permissions.addAdmin") : t("settings.permissions.noRoles")} data-tip-sub={roles.length ? undefined : t("settings.permissions.noRolesSub")}>
                                        <PlusIcon />{t("settings.permissions.adminRole")}
                                    </button>
                                    <span className="grow" />
                                    <span className="note" data-tip={t("settings.permissions.emergencyTip")} data-tip-sub={t("settings.permissions.emergencySub")}>
                                        {t("settings.permissions.emergency")}
                                    </span>
                                </div>
                            </td>
                        </tr>

                        <GroupRow
                            span={span}
                            label={t("settings.permissions.allSignedIn")}
                            tip={t("settings.permissions.base")}
                            tipSub={t("settings.permissions.baseSub")}
                        />
                        <tr>
                            <td>
                                <RowName label={t("settings.permissions.base")} sub={t("settings.permissions.baseRowSub")} avatar={<span className="perm-avatar round">∗</span>} onAll={(lv) => onBaseAccessChange(allOf(lv))} />
                            </td>
                            {cells("base", "base", t("settings.permissions.base"), baseAccess)}
                            <td />
                        </tr>

                        <GroupRow
                            span={span}
                            label={t("settings.permissions.roles")}
                            tip={t("settings.permissions.roles")}
                            tipSub={t("settings.permissions.rolesSub")}
                        />
                        {!roleIds.length && (
                            <tr><td colSpan={span} className="perm-empty">
                                {roles.length ? t("settings.permissions.rolesEmpty") : t("settings.permissions.rolesNotLoaded")}
                            </td></tr>
                        )}
                        {roleIds.map((id) => {
                            const role = roleById.get(id);
                            const name = roleName(id);
                            return (
                                <tr key={id} className={role ? undefined : "perm-unknown"}>
                                    <td>
                                        <RowName
                                            label={name}
                                            sub={role ? grantSummary(areas, value[id]) : t("settings.permissions.notOnServer")}
                                            avatar={<span className="perm-avatar" style={role?.color ? { "--rc": role.color } as CSSProperties : undefined}>@</span>}
                                            onAll={(lv) => setRole(id, allOf(lv))}
                                        />
                                    </td>
                                    {cells("role", id, name, value[id])}
                                    <td className="cell-act">
                                        <IconButton icon={<TrashIcon />} tip={t("settings.permissions.removeTip", { name })} size="sm" tone="danger" onClick={() => {
                                            const next = { ...value };
                                            delete next[id];
                                            onChange(next);
                                        }} />
                                    </td>
                                </tr>
                            );
                        })}

                        <GroupRow
                            span={span}
                            label={t("settings.permissions.users")}
                            tip={t("settings.permissions.users")}
                            tipSub={t("settings.permissions.usersSub")}
                        />
                        {!userIds.length && (
                            <tr><td colSpan={span} className="perm-empty">{t("settings.permissions.usersEmpty")}</td></tr>
                        )}
                        {userIds.map((id) => {
                            const name = userNames[id] || t("settings.account", { id: id.slice(-4) });
                            return (
                                <tr key={id}>
                                    <td>
                                        <RowName
                                            label={name}
                                            sub={`Discord · ${id}`}
                                            avatar={<span className="perm-avatar round">{name.slice(0, 1).toUpperCase()}</span>}
                                            onAll={(lv) => setUser(id, allOf(lv))}
                                        />
                                    </td>
                                    {cells("user", id, name, userPermissions[id])}
                                    <td className="cell-act">
                                        <IconButton icon={<TrashIcon />} tip={t("settings.permissions.removeTip", { name })} size="sm" tone="danger" onClick={() => {
                                            const next = { ...userPermissions };
                                            delete next[id];
                                            onUserPermissionsChange(next);
                                        }} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {adding && (
                <AddOwnerModal
                    mode={adding}
                    roles={roles}
                    taken={adding === "admin" ? adminRoleIds : [...Object.keys(value), ...adminRoleIds]}
                    takenUsers={userIds}
                    onClose={() => setAdding(null)}
                    onAddRole={(roleId) => {
                        if (adding === "admin") onAdminRoleIds([...adminRoleIds, roleId]);
                        else onChange({ ...value, [roleId]: {} });
                        setAdding(null);
                    }}
                    onAddUser={(userId) => {
                        onUserPermissionsChange({ ...userPermissions, [userId]: {} });
                        setAdding(null);
                    }}
                />
            )}
        </>
    );
}

/** "Rolle oder Konto": pick a role, or enter a Discord id (checked as a snowflake). */
function AddOwnerModal({ mode, roles, taken, takenUsers, onClose, onAddRole, onAddUser }: {
    mode: "grant" | "admin";
    roles: Role[];
    taken: string[];
    takenUsers: string[];
    onClose: () => void;
    onAddRole: (roleId: string) => void;
    onAddUser: (userId: string) => void;
}) {
    const [kind, setKind] = useState<"role" | "user">(roles.length || mode === "admin" ? "role" : "user");
    const [roleId, setRoleId] = useState("");
    const [userId, setUserId] = useState("");
    const addable = roles.filter((r) => !taken.includes(r.id));
    const trimmed = userId.trim();
    const idValid = isDiscordId(trimmed);
    const duplicate = idValid && takenUsers.includes(trimmed);
    const canAdd = kind === "role" ? !!roleId : idValid && !duplicate;
    const t = useT();

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_scroll_11"
            tone="settings"
            kicker={t("settings.sections.berechtigungen.label")}
            title={mode === "admin" ? t("settings.permissions.addAdmin") : t("settings.permissions.addTitle")}
            width={480}
            initialFocus="select, input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!canAdd} onClick={() => (kind === "role" ? onAddRole(roleId) : onAddUser(trimmed))}>{t("common.add")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                {mode === "grant" && (
                    <Segment
                        ariaLabel={t("settings.permissions.kind")}
                        value={kind}
                        onChange={(v) => setKind(v === "user" ? "user" : "role")}
                        options={[
                            { value: "role", label: t("settings.permissions.kindRole"), disabled: !roles.length, tip: roles.length ? undefined : t("settings.permissions.noRoles") },
                            { value: "user", label: t("settings.permissions.kindUser") },
                        ]}
                    />
                )}
                {kind === "role" ? (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="perm-add-role" tip={t("settings.permissions.role")} tipSub={mode === "admin" ? t("settings.permissions.roleAdminSub") : t("settings.permissions.roleGrantSub")}>{t("settings.permissions.role")}</FieldLabel>
                        <select id="perm-add-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                            <option value="">{t("settings.permissions.chooseRole")}</option>
                            {addable.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                        </select>
                        {!addable.length && <div className="note">{t("settings.permissions.allTaken")}</div>}
                    </div>
                ) : (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="perm-add-user" tip={t("settings.permissions.discordId")} tipSub={t("settings.permissions.discordIdSub")}>{t("settings.permissions.discordId")}</FieldLabel>
                        <input id="perm-add-user" className="mono" inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t("settings.permissions.idPlaceholder")} />
                        {trimmed && !idValid && <div className="note is-bad">{t("settings.permissions.invalidId")}</div>}
                        {duplicate && <div className="note is-bad">{t("settings.permissions.duplicate")}</div>}
                    </div>
                )}
            </div>
        </Modal>
    );
}
