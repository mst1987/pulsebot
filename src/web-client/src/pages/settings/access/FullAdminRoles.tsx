import { useState } from "react";
import type { AdminRole } from "../../../api";
import { useT } from "../../../i18n";
import { Button, IconButton } from "../../../components/ui/Button";
import PartHead from "../../../components/ui/PartHead";
import { PlusIcon, TrashIcon } from "../../../components/ui/icons";
import { SortTh } from "../../../components/ui/SortTh";
import { useTableSort, type Dir } from "../../../lib/ui/tableSort";
import { AddOwnerModal } from "./RolePermissions";

type SortKey = "role" | "server";
const SORT_DEFAULTS: Record<SortKey, Dir> = { role: "asc", server: "asc" };

// Einstellungen › Alle Server › Voll-Admins (#925): the roles whose members may
// do everything on every server. The only access setting the bot shares - the
// rest (Berechtigungen) belongs to one server each. The roles come from every
// server the bot knows, so each row names its server.

export default function FullAdminRoles({ roles, value, onChange, icon, crumb, title, roleOrigins = {} }: {
    /** Fallback for a role missing from roles: where the bot still finds it (GET /api/settings → roleOrigins). */
    roleOrigins?: Record<string, AdminRole>;
    /** The roles of every configured server (GET /api/settings → adminRoles). */
    roles: AdminRole[];
    value: string[];
    onChange: (next: string[]) => void;
    icon: string;
    crumb: string;
    title: string;
}) {
    const t = useT();
    const [adding, setAdding] = useState(false);
    const byId = new Map(roles.map((r) => [r.id, r]));
    const roleOf = (id: string): AdminRole | undefined => byId.get(id) || roleOrigins[id];
    const { sort, dir, onSort, apply } = useTableSort<SortKey>("full-admins-sort", SORT_DEFAULTS, "role");
    const nameOf = (id: string) => {
        const role = roleOf(id);
        return role ? `@${role.name}` : t("settings.permissions.unknownRole", { id });
    };
    const rows = apply(value, (id, key) => (key === "server" ? roleOf(id)?.guildName || "" : nameOf(id)).toLowerCase());

    return (
        <>
            <PartHead
                icon={icon}
                tone="settings"
                title={title}
                crumb={t("settings.crumbAll", { crumb })}
                tip={t("settings.permissions.admins")}
                tipSub={t("settings.permissions.adminsSub")}
                action={(
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setAdding(true)} disabled={!roles.length}
                        data-tip={roles.length ? t("settings.permissions.addAdmin") : t("settings.permissions.noRoles")}
                        data-tip-sub={roles.length ? undefined : t("settings.permissions.noRolesSub")}>
                        {t("settings.permissions.adminRole")}
                    </Button>
                )}
            />
            <div className="full-admins">
                {value.length ? (
                    <table className="full-admins-table">
                        <thead>
                            <tr>
                                <SortTh sortKey="role" label={t("settings.permissions.role")} sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="server" label={t("settings.permissions.server")} sort={sort} dir={dir} onSort={onSort} />
                                <th aria-label={t("settings.permissions.actions")} />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((id) => {
                                const role = roleOf(id);
                                const name = nameOf(id);
                                return (
                                    <tr key={id}>
                                        <td className="full-admins-name" data-tip={name} data-tip-sub={t("settings.permissions.roleId", { id })} tabIndex={0}>{name}</td>
                                        <td className="note">{role?.guildName || "–"}</td>
                                        <td className="full-admins-act">
                                            <IconButton
                                                icon={<TrashIcon />}
                                                size="sm"
                                                tone="danger"
                                                tip={t("settings.permissions.removeTip", { name })}
                                                onClick={() => onChange(value.filter((x) => x !== id))}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <p className="note">{t("settings.permissions.noAdminRoles")}</p>
                )}
                <p className="note" data-tip={t("settings.permissions.emergencyTip")} data-tip-sub={t("settings.permissions.emergencySub")} tabIndex={0}>
                    {t("settings.permissions.emergency")}
                </p>
            </div>

            {adding && (
                <AddOwnerModal
                    mode="admin"
                    roles={roles}
                    taken={value}
                    takenUsers={[]}
                    onClose={() => setAdding(false)}
                    onAddRole={(roleId) => { onChange([...value, roleId]); setAdding(false); }}
                    onAddUser={() => setAdding(false)}
                />
            )}
        </>
    );
}
