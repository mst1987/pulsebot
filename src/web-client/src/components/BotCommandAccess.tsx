import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    getBotCommands, updateSettings,
    type ApiError, type BotAccessMode, type BotAccessRule, type BotCommand, type BotCommandsData, type BotRole,
} from "../api";
import {
    MODE_LABEL, commandLabel, commandsOfGroup, customizedCount, groupSummary, ruleOf, ruleValid, sameRule,
    withGroupRule, withRule, type AccessMap,
} from "../lib/botCommandAccess";
import { useToast } from "./Jobs";
import { Button, IconButton } from "./ui/Button";
import { Modal } from "./ui/Modal";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import IconTile from "./ui/IconTile";
import PartHead from "./ui/PartHead";
import Segment from "./ui/Segment";
import RaidLoader from "./ui/RaidLoader";
import { LockIcon, XIcon } from "./icons";
import { FieldLabel, PenIcon } from "./settingsUi";

// Einstellungen → Berechtigungen → Bot-Befehle (issue #252): who may use which
// bot command in Discord. One line per command group, folded; open, one row per
// command with its roles as badges and a pencil that opens the modal. Admins may
// always use everything, so the page only ever talks about everybody else.
//
// Saves itself (PATCH /api/settings { botCommandAccess }) instead of joining the
// page's shared draft: a rule is set in its modal and applies right away.

const MODES: BotAccessMode[] = ["everyone", "roles", "admins"];

const MODE_TIPS: Record<BotAccessMode, string> = {
    everyone: "Jedes Mitglied darf den Befehl nutzen.",
    roles: "Nur Mitglieder mit einer der gewählten Rollen (auf dem Event-Server).",
    admins: "Nur Admins: ADMIN_USER_ID und die Admin-Rollen aus „Zugang“.",
};

function roleTip(role: BotRole | undefined, id: string): { tip: string; sub: string } {
    if (!role) return { tip: "Unbekannte Rolle", sub: `Rollen-ID ${id} — gibt es auf dem Event-Server nicht mehr.` };
    const members = role.memberCount === null ? "Mitgliederzahl unbekannt" : `${role.memberCount} ${role.memberCount === 1 ? "Mitglied" : "Mitglieder"}`;
    return { tip: `@${role.name}`, sub: members };
}

/** The rule as badges: "Jeder", "Nur Admins" or one badge per role. */
function RuleBadges({ rule, roleById }: { rule: BotAccessRule; roleById: Map<string, BotRole> }) {
    if (rule.mode === "everyone") return <Badge tone="ok" tip="Jeder" tipSub={MODE_TIPS.everyone}>Jeder</Badge>;
    if (rule.mode === "admins") return <Badge icon={<LockIcon />} tip="Nur Admins" tipSub={MODE_TIPS.admins}>Nur Admins</Badge>;
    return (
        <>
            {rule.roleIds.map((id) => {
                const role = roleById.get(id);
                const { tip, sub } = roleTip(role, id);
                return <Badge key={id} tone={role ? "accent" : "bad"} tip={tip} tipSub={sub}>{role ? `@${role.name}` : "Unbekannte Rolle"}</Badge>;
            })}
        </>
    );
}

export default function BotCommandAccess({ csrfToken, viewSwitch, icon, crumb }: {
    csrfToken: string | null;
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
            title="Bot-Befehle"
            crumb={`Einstellungen › ${crumb}`}
            tip="Bot-Befehle"
            tipSub="Wer welchen Befehl im Discord nutzen darf. Buttons und Auswahlen eines Befehls erben seine Freigabe. Admins dürfen immer alles."
            action={viewSwitch}
        />
    );

    if (error) return <>{head}<div className="empty">Bot-Befehle konnten nicht geladen werden: {error}</div></>;
    if (!data) return <>{head}<RaidLoader compact text="Bot-Befehle werden geladen" /></>;

    const map: AccessMap = {};
    for (const c of data.commands) if (c.access) map[c.name] = c.access;
    const roleName = (id: string) => (roleById.get(id) ? `@${roleById.get(id)!.name}` : "Unbekannte Rolle");
    const editCommand = data.commands.find((c) => c.name === editing) || null;

    const save = async (next: AccessMap, message: string) => {
        setSaving(true);
        try {
            const { config } = await updateSettings(csrfToken, { botCommandAccess: next });
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
                <span>Admins dürfen immer alles{data.guildName ? <> · Rollen von <strong>{data.guildName}</strong></> : null}</span>
            </div>
            {!data.roles.length && (
                <div className="botc-note note is-bad">Keine Rollen geladen — ist der Bot online und der Event-Server gewählt?</div>
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
                                    <Badge tone="mid" tip="Angepasst" tipSub={`${changed} von ${commands.length} weichen vom Standard ab.`}>
                                        {changed} angepasst
                                    </Badge>
                                )}
                                <Expand open={isOpen} onToggle={() => toggle(group.id)} />
                            </div>
                            {isOpen && (
                                <div className="botc-rows">
                                    {commands.map((command) => (
                                        <div key={command.name} className="botc-row">
                                            <div className="botc-cmd">
                                                <span className="botc-name" data-tip={commandLabel(command)} data-tip-sub={command.inherits.length ? `Gilt auch für: ${command.inherits.join(", ")}` : undefined}>
                                                    {commandLabel(command)}
                                                </span>
                                                <span className="botc-desc">{command.description}</span>
                                            </div>
                                            <div className="botc-badges">
                                                <RuleBadges rule={ruleOf(command, map)} roleById={roleById} />
                                            </div>
                                            <IconButton icon={<PenIcon />} tip={`${commandLabel(command)} bearbeiten`} size="sm" onClick={() => setEditing(command.name)} />
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
                        wholeGroup ? "Für alle Befehle der Gruppe gespeichert." : `${commandLabel(editCommand)} gespeichert.`,
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
                <span data-tip="Erbt die Freigabe" data-tip-sub={command.inherits.join(", ")}>
                    gilt auch für {command.inherits.length} {command.inherits.length === 1 ? "Button/Modal" : "Buttons/Modals"}
                </span>
            ) : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button disabled={!ruleValid(draft) || saving} running={saving} onClick={() => onSave(draft, wholeGroup)}>Speichern</Button>
                </>
            )}
        >
            <div className="conn-form">
                {command.description && <div className="note">{command.description}</div>}
                <Segment<BotAccessMode>
                    ariaLabel="Wer darf"
                    value={mode}
                    onChange={setMode}
                    options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m], tip: MODE_TIPS[m] }))}
                />
                {mode === "roles" && (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="botc-add-role" tip="Rollen" tipSub="Rollen des Event-Servers. Wer eine davon hat, darf den Befehl nutzen.">Rollen</FieldLabel>
                        <div className="botc-roles">
                            {roleIds.map((id) => {
                                const role = roleById.get(id);
                                const { sub } = roleTip(role, id);
                                return (
                                    <button key={id} type="button" className={`badge ${role ? "accent" : "bad"} botc-role`}
                                        data-tip={`${role ? `@${role.name}` : "Unbekannte Rolle"} entfernen`} data-tip-sub={sub}
                                        onClick={() => setRoleIds(roleIds.filter((r) => r !== id))}>
                                        {role ? `@${role.name}` : "Unbekannte Rolle"}<XIcon />
                                    </button>
                                );
                            })}
                            <select id="botc-add-role" value="" disabled={!addable.length}
                                onChange={(e) => { if (e.target.value) setRoleIds([...roleIds, e.target.value]); }}>
                                <option value="">{roles.length ? "+ Rolle" : "Keine Rollen geladen"}</option>
                                {addable.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                            </select>
                        </div>
                        {!roleIds.length && <div className="note is-bad">Mindestens eine Rolle wählen.</div>}
                    </div>
                )}
                <div className="botc-default">
                    <span className="kicker">Standard</span>
                    <RuleBadges rule={command.defaultAccess} roleById={roleById} />
                    <span className="grow" />
                    <Button variant="ghost" size="sm" disabled={isDefault}
                        onClick={() => { setMode(command.defaultAccess.mode); setRoleIds(command.defaultAccess.roleIds); }}>
                        Zurücksetzen
                    </Button>
                </div>
                {groupSize > 1 && (
                    <label className="botc-check">
                        <input type="checkbox" checked={wholeGroup} onChange={(e) => setWholeGroup(e.target.checked)} />
                        <span>für alle {groupSize} Befehle der Gruppe übernehmen</span>
                    </label>
                )}
            </div>
        </Modal>
    );
}
