// The roster part of the switch dialog (#739, Einstellungen → Spielversion): a
// category has one roster per game version, so switching it closes the roster
// of the old version (readable under that version, no Discord sync, nobody loses
// a role) and may start one for the new version — from the old one's settings,
// with "Personen übernehmen" (everybody as Probe, without a character: each
// raider picks the character of the new version himself) and the Discord roles
// picked here (none by default; the category's raider roles then stay empty
// until they are set in the roster's settings). The choice goes into the page
// draft with the series' fix; the save makes it happen (services/roster/rosterVersionSwitch.js).
import type { CategorySwitchPreview, Role, RosterSwitchChoice } from "../../../api";
import Chip from "../../../components/ui/Chip";
import Switch from "../../../components/ui/form/Switch";
import { useT } from "../../../i18n";
import { assignableRoles } from "../../../lib/settings/assignableRoles";

export default function CategorySwitchRoster({ preview, roles, value, onChange }: {
    preview: CategorySwitchPreview;
    roles: Role[];
    value: RosterSwitchChoice;
    onChange: (next: RosterSwitchChoice) => void;
}) {
    const t = useT();
    const info = preview.roster;
    if (!info || (!info.closing && !info.existing)) return null;
    const from = preview.from.short;
    const to = preview.to.short;
    const toggleRole = (id: string) => onChange({ ...value, roleIds: value.roleIds.includes(id) ? value.roleIds.filter((r) => r !== id) : [...value.roleIds, id] });
    // a bot's own role (@MEE6) can be given to nobody: no chip for it (#745)
    const offered = assignableRoles(roles, value.roleIds);
    return (
        <section className="csw-part" aria-label={t("settings.categorySwitch.rosterTitle")}>
            <h3 className="csw-head">{t("settings.categorySwitch.rosterTitle")}</h3>
            {info.closing && <p>{t("settings.categorySwitch.rosterCloses", { name: info.closing.name, from })}</p>}
            {info.existing && (
                <p className="csw-quiet">
                    {info.existing.reopens
                        ? t("settings.categorySwitch.rosterReopens", { name: info.existing.name, to })
                        : t("settings.categorySwitch.rosterExists", { name: info.existing.name, to })}
                </p>
            )}
            {info.canCreate && (
                <div className="csw-roster">
                    <Switch
                        checked={value.create}
                        onChange={(create) => onChange({ ...value, create })}
                        label={t("settings.categorySwitch.rosterCreate", { to })}
                        tip={t("settings.categorySwitch.rosterCreateTip")}
                    />
                    {value.create && (
                        <>
                            <Switch
                                checked={value.copyMembers}
                                onChange={(copyMembers) => onChange({ ...value, copyMembers })}
                                label={t("settings.categorySwitch.rosterCopy")}
                                tip={t("settings.categorySwitch.rosterCopyTip", { count: info.closing ? info.closing.members : 0, to })}
                            />
                            <div className="csw-roles">
                                <span className="csw-lbl">{t("settings.categorySwitch.rosterRoles")}</span>
                                {offered.length ? (
                                    <div className="chip-row" role="group" aria-label={t("settings.categorySwitch.rosterRoles")}>
                                        {offered.map((r) => (
                                            <Chip key={r.id} pressed={value.roleIds.includes(r.id)} onClick={() => toggleRole(r.id)}>@{r.name || r.id}</Chip>
                                        ))}
                                    </div>
                                ) : null}
                                <p className="csw-quiet">{value.roleIds.length ? t("settings.categorySwitch.rosterRolesSome", { count: value.roleIds.length }) : t("settings.categorySwitch.rosterRolesNone")}</p>
                            </div>
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
