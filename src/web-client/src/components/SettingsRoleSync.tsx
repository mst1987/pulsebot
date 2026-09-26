import { useEffect, useState } from "react";
import {
    getRoleSync, updateSettings,
    type AdminConfig, type ApiError, type RoleSyncData, type RoleSyncRule,
} from "../api";
import { DIRECTION_LABEL, DIRECTION_TEXT, driftBadge, roleSyncPatch, withRoleRule, type RoleSyncDirection } from "../lib/settingsLogic";
import { useToast } from "./Jobs";
import { PlusIcon, TrashIcon } from "./icons";
import { Modal, useConfirm } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import PartHead from "./ui/PartHead";
import RaidLoader from "./ui/RaidLoader";
import Segment from "./ui/Segment";
import { AdminOnlyBadge, FieldLabel, PenIcon, RolePicker, WarnIcon } from "./settingsUi";

// Einstellungen → Verbindungen → Discord-Server, part "Rollen-Abgleich" (#264).
// One line per role pair; add and edit in a dialog. The sync only ever adds a
// role — whoever lost the source role keeps the synced one, and the drift badge
// with its fold-out list says who, with a link to the Discord profile, so a
// person removes it there.

const DIRECTIONS: { value: RoleSyncDirection; label: string; tip: string }[] = [
    { value: "toTalk", label: "Event → Talk", tip: "Wer die Rolle auf dem Event-Discord hat, bekommt sie auf dem Kommunikations-Discord." },
    { value: "toEvent", label: "Talk → Event", tip: "Wer die Rolle auf dem Kommunikations-Discord hat, bekommt sie auf dem Event-Discord." },
    { value: "both", label: "Beide", tip: "In beide Richtungen." },
];

const roleName = (roles: { id: string; name: string }[], id: string) => {
    const r = roles.find((x) => x.id === id);
    return r ? `@${r.name}` : id;
};

export default function RoleSyncPart({ csrfToken, onConfig }: {
    csrfToken: string | null;
    onConfig: (config: AdminConfig) => void;
}) {
    const [data, setData] = useState<RoleSyncData | null>(null);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<number | null>(null);
    const [driftOpen, setDriftOpen] = useState(false);
    const ask = useConfirm();
    const toast = useToast();

    const load = () => {
        getRoleSync().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
    };
    useEffect(load, []);

    const save = async (rules: RoleSyncRule[], message: string) => {
        const { config } = await updateSettings(csrfToken, roleSyncPatch(rules) as Partial<AdminConfig>);
        toast(message);
        onConfig(config);
        load();
    };

    const remove = async (index: number) => {
        if (!data) return;
        const rule = data.roleSync[index];
        const label = `${roleName(data.eventRoles, rule.eventRoleId)} ${DIRECTION_LABEL[rule.direction]} ${roleName(data.talkRoles, rule.talkRoleId)}`;
        if (!(await ask({ title: `Zuordnung ${label} löschen?`, text: "Vergebene Rollen bleiben, wie sie sind — der Abgleich entfernt nie etwas.", action: "Löschen", tone: "danger" }))) return;
        try {
            await save(data.roleSync.filter((_, i) => i !== index), "Zuordnung gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const drift = data ? driftBadge(data.driftTotal, data.driftError) : null;
    const head = (
        <PartHead
            icon="inv_misc_groupneedmore"
            tone="settings"
            title="Rollen-Abgleich"
            tip="Rollen-Abgleich"
            tipSub="Ordnet eine Rolle des Event-Discords einer Rolle des Kommunikations-Discords zu. Läuft bei jeder Rollenänderung und alle 10 Minuten. Er vergibt nur und entfernt nie."
            action={data ? (
                <span className="sync-actions">
                    {data.roleSync.length > 0 && drift && (
                        <Badge tone={drift.tone || undefined} icon={drift.tone === "mid" ? <WarnIcon /> : undefined} tip={drift.label} tipSub={drift.tip}>{drift.label}</Badge>
                    )}
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setEditing(-1)}>Zuordnung</Button>
                </span>
            ) : undefined}
        />
    );

    if (error) return <section className="sync-part">{head}<div className="empty">{error}</div></section>;
    if (!data) return <section className="sync-part">{head}<RaidLoader compact text="Rollen werden abgeglichen" /></section>;

    // The sides a mapping writes to, and which of them the bot may not touch.
    const needs = new Set(data.roleSync.flatMap((r) => (r.direction === "both" ? ["event", "talk"] : [r.direction === "toTalk" ? "talk" : "event"])));
    const blocked = [...needs].filter((side) => !data.canManage[side as "event" | "talk"]);

    return (
        <section className="sync-part">
            {head}
            {blocked.length > 0 && (
                <div className="conn-status mid">
                    <Badge tone="mid" icon={<WarnIcon />}>Recht fehlt</Badge>
                    <span>
                        „Rollen verwalten“ fehlt auf dem {blocked.map((s) => (s === "talk" ? "Kommunikations-Discord" : "Event-Discord")).join(" und dem ")} — dort vergibt der Abgleich nichts.
                    </span>
                </div>
            )}
            {data.roleSync.length === 0
                ? <div className="sync-empty">Noch keine Zuordnung. Ohne Zuordnung werden keine Rollen vergeben.</div>
                : (
                    <ul className="sync-list">
                        {data.roleSync.map((rule, i) => (
                            <li key={`${rule.eventRoleId}:${rule.talkRoleId}`} className="sync-row">
                                <span className="sync-role">{roleName(data.eventRoles, rule.eventRoleId)}</span>
                                <span className="sync-dir" data-tip={DIRECTION_TEXT[rule.direction]}>{DIRECTION_LABEL[rule.direction]}</span>
                                <span className="sync-role">{roleName(data.talkRoles, rule.talkRoleId)}</span>
                                <span className="grow" />
                                <IconButton size="sm" icon={<PenIcon />} tip="Zuordnung bearbeiten" onClick={() => setEditing(i)} />
                                <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Zuordnung löschen" onClick={() => remove(i)} />
                            </li>
                        ))}
                    </ul>
                )}
            {data.driftTotal > 0 && (
                <div className="sync-drift">
                    <div className="sync-drift-head">
                        <span className="grow">
                            {data.drift.map((g) => (
                                <span key={g.ruleIndex} className="sync-drift-line">
                                    <b>{g.members.length}</b> {g.members.length === 1 ? "Mitglied hat" : "Mitglieder haben"} <b>@{g.roleName}</b> nur noch auf {g.guildName || (g.side === "talk" ? "dem Kommunikations-Discord" : "dem Event-Discord")}
                                </span>
                            ))}
                        </span>
                        <Expand open={driftOpen} onToggle={() => setDriftOpen(!driftOpen)} label="Wer" />
                    </div>
                    {driftOpen && (
                        <ul className="sync-drift-list">
                            {data.drift.flatMap((g) => g.members.map((m) => (
                                <li key={`${g.ruleIndex}:${m.userId}`}>
                                    <a href={m.profileUrl} target="_blank" rel="noreferrer" data-tip={`@${g.roleName} entfernen`} data-tip-sub={m.notOnSource ? "Nicht mehr auf dem anderen Server. Entfernen in Discord." : `Hat @${g.sourceRoleName} nicht mehr. Entfernen in Discord.`}>{m.name}</a>
                                    <span className="sync-muted">@{g.roleName}</span>
                                </li>
                            )))}
                        </ul>
                    )}
                </div>
            )}

            {editing !== null && (
                <RoleRuleModal
                    data={data}
                    index={editing}
                    onClose={() => setEditing(null)}
                    onSave={async (rule) => {
                        await save(withRoleRule(data.roleSync, editing, rule), "Zuordnung gespeichert.");
                        setEditing(null);
                    }}
                />
            )}
        </section>
    );
}

/** Add (index -1) or edit one role pair. */
function RoleRuleModal({ data, index, onClose, onSave }: {
    data: RoleSyncData;
    index: number;
    onClose: () => void;
    onSave: (rule: RoleSyncRule) => Promise<void>;
}) {
    const existing = index >= 0 ? data.roleSync[index] : null;
    const [rule, setRule] = useState<RoleSyncRule>(existing || { eventRoleId: "", talkRoleId: "", direction: "toTalk" });
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async () => {
        setBusy(true);
        try {
            await onSave(rule);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="settings"
            kicker="Rollen-Abgleich"
            title={existing ? "Zuordnung bearbeiten" : "Zuordnung anlegen"}
            width={520}
            initialFocus="select, input"
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
                    <Button onClick={submit} disabled={busy || !rule.eventRoleId || !rule.talkRoleId}>{busy ? "Speichert…" : "Speichern"}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="dlg-field">
                    <FieldLabel htmlFor="sync-event" tip="Rolle auf dem Event-Discord">Event-Discord</FieldLabel>
                    <RolePicker id="sync-event" value={rule.eventRoleId} roles={data.eventRoles} onChange={(eventRoleId) => setRule({ ...rule, eventRoleId })} />
                </div>
                <div className="dlg-field">
                    <FieldLabel tip="Richtung" tipSub="Der Abgleich vergibt nur. Eine verlorene Rolle bleibt auf der anderen Seite und erscheint als Abweichung.">Richtung</FieldLabel>
                    <Segment size="sm" ariaLabel="Richtung" options={DIRECTIONS} value={rule.direction} onChange={(direction) => setRule({ ...rule, direction })} />
                </div>
                <div className="dlg-field">
                    <FieldLabel htmlFor="sync-talk" tip="Rolle auf dem Kommunikations-Discord">Kommunikations-Discord</FieldLabel>
                    <RolePicker id="sync-talk" value={rule.talkRoleId} roles={data.talkRoles} onChange={(talkRoleId) => setRule({ ...rule, talkRoleId })} />
                </div>
            </div>
        </Modal>
    );
}
