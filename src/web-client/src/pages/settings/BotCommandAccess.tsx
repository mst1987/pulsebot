import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    getBotCommands, updateSettings,
    type ApiError, type BotAccessMode, type BotAccessRule, type BotCommand, type BotCommandsData, type BotRole,
} from "../../api";
import {
    commandLabel, commandsOfGroup, customizedCount, groupSummary, modeLabel, ruleOf, ruleValid, sameRule,
    withGroupRule, withRule, type AccessMap,
} from "../../lib/botCommandAccess";
import { t as translate, useT } from "../../i18n";
import { useToast } from "../../components/Jobs";
import { Button, IconButton } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import IconTile from "../../components/ui/IconTile";
import PartHead from "../../components/ui/PartHead";
import Segment from "../../components/ui/Segment";
import RaidLoader from "../../components/ui/RaidLoader";
import { LockIcon, XIcon } from "../../components/icons";
import { PenIcon } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";

// Einstellungen → Berechtigungen → Bot-Befehle (issue #252): who may use which
// bot command in Discord. One line per command group, folded; open, one row per
// command with its roles as badges and a pencil that opens the modal. Admins may
// always use everything, so the page only ever talks about everybody else.
//
// Saves itself (PATCH /api/settings { botCommandAccess }) instead of joining the
// page's shared draft: a rule is set in its modal and applies right away.

const MODES: BotAccessMode[] = ["everyone", "roles", "admins"];

/** What a mode means, in the active language. */
const modeTip = (mode: BotAccessMode): string => translate(`settings.botCommands.modeTip.${mode}`);

function roleTip(role: BotRole | undefined, id: string): { tip: string; sub: string } {
    if (!role) return { tip: translate("settings.botCommands.unknownRole"), sub: translate("settings.botCommands.unknownRoleSub", { id }) };
    const members = role.memberCount === null ? translate("settings.botCommands.membersUnknown") : translate("settings.botCommands.members", { count: role.memberCount });
    return { tip: `@${role.name}`, sub: members };
}

/** The rule as badges: "Jeder", "Nur Admins" or one badge per role. */
function RuleBadges({ rule, roleById }: { rule: BotAccessRule; roleById: Map<string, BotRole> }) {
    const t = useT();
    if (rule.mode === "everyone") return <Badge tone="ok" tip={modeLabel("everyone")} tipSub={modeTip("everyone")}>{modeLabel("everyone")}</Badge>;
    if (rule.mode === "admins") return <Badge icon={<LockIcon />} tip={modeLabel("admins")} tipSub={modeTip("admins")}>{modeLabel("admins")}</Badge>;
    return (
        <>
            {rule.roleIds.map((id) => {
                const role = roleById.get(id);
                const { tip, sub } = roleTip(role, id);
                return <Badge key={id} tone={role ? "accent" : "bad"} tip={tip} tipSub={sub}>{role ? `@${role.name}` : t("settings.botCommands.unknownRole")}</Badge>;
            })}
        </>
    );
}

export default function BotCommandAccess({ viewSwitch, icon, crumb }: {
    /** The Bereiche · Bot-Befehle segment, shown in the part head. */
    viewSwitch: ReactNode;
    icon: string;
    crumb: string;
}) {
    const [data, setData] = useState<BotCommandsData | null>(null);
    const [error, setError] = useState<string>("");
    const [open, setOpen] = useState<string[]>([]);
    const [editing, setEditing] = useState<string>("");
    const [saving, setSaving] = useState(false);
    const toast = useToast();
    const t = useT();

    useEffect(() => {
        getBotCommands()
            .then((d) => { setData(d); if (d.groups[0]) setOpen([d.groups[0].id]); })
            .catch((err: ApiError) => setError(err.message));
    }, []);

    const roleById = useMemo(() => new Map((data?.roles || []).map((r) => [r.id, r])), [data]);

    const head = (
        <PartHead
            icon={icon}
            tone="settings"
            title={t("settings.botCommands.title")}
            crumb={t("settings.crumb", { crumb })}
            tip={t("settings.botCommands.title")}
            tipSub={t("settings.botCommands.tipSub")}
            action={viewSwitch}
        />
    );

    if (error) return <>{head}<div className="empty">{t("settings.botCommands.loadError", { message: error })}</div></>;
    if (!data) return <>{head}<RaidLoader compact text={t("settings.botCommands.loading")} /></>;

    const map: AccessMap = {};
    for (const c of data.commands) if (c.access) map[c.name] = c.access;
    const roleName = (id: string) => (roleById.get(id) ? `@${roleById.get(id)!.name}` : t("settings.botCommands.unknownRole"));
    const editCommand = data.commands.find((c) => c.name === editing) || null;

    const save = async (next: AccessMap, message: string) => {
        setSaving(true);
        try {
            const { config } = await updateSettings({ botCommandAccess: next });
            const stored = config.botCommandAccess || {};
            setData({
                ...data,
                commands: data.commands.map((c) => {
                    const access = stored[c.name] || null;
                    return { ...c, access, effective: access || c.defaultAccess };
                }),
            });
            setEditing("");
            toast(message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const toggle = (id: string) => setOpen(open.includes(id) ? open.filter((g) => g !== id) : [...open, id]);

    return (
        <>
            {head}
            <div className="botc-note note">
                <LockIcon />
                <span>{t("settings.botCommands.adminsAlways")}{data.guildName ? <> · {t("settings.botCommands.rolesOf")} <strong>{data.guildName}</strong></> : null}</span>
            </div>
            {!data.roles.length && (
                <div className="botc-note note is-bad">{t("settings.botCommands.noRoles")}</div>
            )}
            <div className="botc-groups">
                {data.groups.map((group) => {
                    const commands = commandsOfGroup(data.commands, group.id);
                    const isOpen = open.includes(group.id);
                    const changed = customizedCount(commands, map);
                    return (
                        <section key={group.id} className={`botc-group${isOpen ? " is-open" : ""}`}>
                            <div className="botc-group-head">
                                <IconTile icon={group.icon} tone="settings" />
                                <button type="button" className="botc-group-name" onClick={() => toggle(group.id)} aria-expanded={isOpen}>
                                    <span className="botc-title">{group.label}</span>
                                    <span className="kicker">{groupSummary(commands, map, roleName)}</span>
                                </button>
                                {changed > 0 && (
                                    <Badge tone="mid" tip={t("settings.botCommands.changedTip")} tipSub={t("settings.botCommands.changedSub", { changed, total: commands.length })}>
                                        {t("settings.botCommands.changed", { count: changed })}
                                    </Badge>
                                )}
                                <Expand open={isOpen} onToggle={() => toggle(group.id)} />
                            </div>
                            {isOpen && (
                                <div className="botc-rows">
                                    {commands.map((command) => (
                                        <div key={command.name} className="botc-row">
                                            <div className="botc-cmd">
                                                <span className="botc-name" data-tip={commandLabel(command)} data-tip-sub={command.inherits.length ? t("settings.botCommands.inherits", { list: command.inherits.join(", ") }) : undefined}>
                                                    {commandLabel(command)}
                                                </span>
                                                <span className="botc-desc">{command.description}</span>
                                            </div>
                                            <div className="botc-badges">
                                                <RuleBadges rule={ruleOf(command, map)} roleById={roleById} />
                                            </div>
                                            <IconButton icon={<PenIcon />} tip={t("settings.botCommands.editTip", { command: commandLabel(command) })} size="sm" onClick={() => setEditing(command.name)} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>

            {editCommand && (
                <CommandModal
                    command={editCommand}
                    groupLabel={data.groups.find((g) => g.id === editCommand.group)?.label || ""}
                    groupIcon={data.groups.find((g) => g.id === editCommand.group)?.icon || "inv_misc_questionmark"}
                    groupSize={commandsOfGroup(data.commands, editCommand.group).length}
                    rule={ruleOf(editCommand, map)}
                    roles={data.roles}
                    roleById={roleById}
                    saving={saving}
                    onClose={() => setEditing("")}
                    onSave={(rule, wholeGroup) => save(
                        wholeGroup ? withGroupRule(map, data.commands, editCommand.group, rule) : withRule(map, editCommand, rule),
                        wholeGroup ? t("settings.botCommands.savedGroup") : t("settings.botCommands.savedOne", { command: commandLabel(editCommand) }),
                    )}
                />
            )}
        </>
    );
}

/** One command: Jeder · Nur Rollen · Nur Admins, the roles, the default and the group action. */
function CommandModal({ command, groupLabel, groupIcon, groupSize, rule, roles, roleById, saving, onClose, onSave }: {
    command: BotCommand;
    groupLabel: string;
    groupIcon: string;
    groupSize: number;
    rule: BotAccessRule;
    roles: BotRole[];
    roleById: Map<string, BotRole>;
    saving: boolean;
    onClose: () => void;
    onSave: (rule: BotAccessRule, wholeGroup: boolean) => void;
}) {
    const [mode, setMode] = useState<BotAccessMode>(rule.mode);
    const [roleIds, setRoleIds] = useState<string[]>(rule.roleIds);
    const [wholeGroup, setWholeGroup] = useState(false);
    const t = useT();
    const draft: BotAccessRule = { mode, roleIds: mode === "roles" ? roleIds : [] };
    const isDefault = sameRule(draft, command.defaultAccess);
    const addable = roles.filter((r) => !roleIds.includes(r.id));

    return (
        <Modal
            open
            onClose={onClose}
            icon={groupIcon}
            tone="settings"
            kicker={groupLabel}
            title={commandLabel(command)}
            width={560}
            hint={command.inherits.length ? (
                <span data-tip={t("settings.botCommands.inheritsTip")} data-tip-sub={command.inherits.join(", ")}>
                    {t("settings.botCommands.inheritsHint", { count: command.inherits.length })}
                </span>
            ) : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!ruleValid(draft) || saving} running={saving} onClick={() => onSave(draft, wholeGroup)}>{t("common.save")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                {command.description && <div className="note">{command.description}</div>}
                <Segment<BotAccessMode>
                    ariaLabel={t("settings.botCommands.whoAria")}
                    value={mode}
                    onChange={setMode}
                    options={MODES.map((m) => ({ value: m, label: modeLabel(m), tip: modeTip(m) }))}
                />
                {mode === "roles" && (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="botc-add-role" tip={t("settings.botCommands.roles")} tipSub={t("settings.botCommands.rolesSub")}>{t("settings.botCommands.roles")}</FieldLabel>
                        <div className="botc-roles">
                            {roleIds.map((id) => {
                                const role = roleById.get(id);
                                const { sub } = roleTip(role, id);
                                return (
                                    <button key={id} type="button" className={`badge ${role ? "accent" : "bad"} botc-role`}
                                        data-tip={t("settings.botCommands.removeTip", { name: role ? `@${role.name}` : t("settings.botCommands.unknownRole") })} data-tip-sub={sub}
                                        onClick={() => setRoleIds(roleIds.filter((r) => r !== id))}>
                                        {role ? `@${role.name}` : t("settings.botCommands.unknownRole")}<XIcon />
                                    </button>
                                );
                            })}
                            <select id="botc-add-role" value="" disabled={!addable.length}
                                onChange={(e) => { if (e.target.value) setRoleIds([...roleIds, e.target.value]); }}>
                                <option value="">{roles.length ? t("settings.botCommands.addRole") : t("settings.botCommands.noRolesLoaded")}</option>
                                {addable.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                            </select>
                        </div>
                        {!roleIds.length && <div className="note is-bad">{t("settings.botCommands.atLeastOne")}</div>}
                    </div>
                )}
                <div className="botc-default">
                    <span className="kicker">{t("settings.botCommands.default")}</span>
                    <RuleBadges rule={command.defaultAccess} roleById={roleById} />
                    <span className="grow" />
                    <Button variant="ghost" size="sm" disabled={isDefault}
                        onClick={() => { setMode(command.defaultAccess.mode); setRoleIds(command.defaultAccess.roleIds); }}>
                        {t("common.reset")}
                    </Button>
                </div>
                {groupSize > 1 && (
                    <label className="botc-check">
                        <input type="checkbox" checked={wholeGroup} onChange={(e) => setWholeGroup(e.target.checked)} />
                        <span>{t("settings.botCommands.wholeGroup", { count: groupSize })}</span>
                    </label>
                )}
            </div>
        </Modal>
    );
}
