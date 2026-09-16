import { useEffect, useState } from "react";
import {
    getReminders, updateSettings,
    type AdminConfig, type ApiError, type PingTarget, type ReminderRule, type RemindersData,
} from "../api";
import { TARGET_TEXT, pingTargetOptions, reminderSummary, remindersPatch } from "../lib/settingsLogic";
import { useToast } from "./Jobs";
import { Modal } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import Badge from "./ui/Badge";
import PartHead from "./ui/PartHead";
import RaidLoader from "./ui/RaidLoader";
import Segment from "./ui/Segment";
import { FieldLabel, PenIcon } from "./settingsUi";

// Einstellungen → Verbindungen → Discord-Server, part "Erinnerungen" (#264).
// One line per raid category: its name, what is set as one short line, and a
// pen that opens the dialog. The rules themselves live in src/web/reminders.js.

const OFF: ReminderRule = { missingHours: 0, signedHours: 0, target: "event" };

export default function RemindersPart({ csrfToken, onConfig }: {
    csrfToken: string | null;
    onConfig: (config: AdminConfig) => void;
}) {
    const [data, setData] = useState<RemindersData | null>(null);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<string | null>(null);
    const toast = useToast();

    const load = () => {
        getReminders().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
    };
    useEffect(load, []);

    const head = (
        <PartHead
            icon="spell_holy_borrowedtime"
            tone="settings"
            title="Erinnerungen"
            tip="Erinnerungen pro Kategorie"
            tipSub="X Stunden vor Anmeldeschluss an alle mit Raider-Rolle, die noch fehlen; Y Stunden vor Raidbeginn an alle Angemeldeten. Jede Erinnerung geht genau einmal raus und nie nach Raidbeginn. Ohne Anmeldeschluss zählt der Raidbeginn."
        />
    );

    if (error) return <section className="sync-part">{head}<div className="empty">{error}</div></section>;
    if (!data) return <section className="sync-part">{head}<RaidLoader compact text="Erinnerungen werden geladen" /></section>;

    const editingCategory = editing ? data.categories.find((c) => c.id === editing) : null;

    return (
        <section className="sync-part">
            {head}
            {data.categories.length === 0
                ? <div className="sync-empty">Noch keine Raid-Kategorien — sie werden unter Einstellungen → Kategorien eingeschaltet.</div>
                : (
                    <ul className="sync-list">
                        {data.categories.map((c) => {
                            const rule = data.categoryReminders[c.id];
                            const off = reminderSummary(rule) === "aus";
                            return (
                                <li key={c.id} className={`sync-row${off ? " is-off" : ""}`}>
                                    {/* A category the bot cannot see (deleted, other server) has no name: say so
                                        instead of showing an 18-digit id; the id stays in the tooltip. */}
                                    {c.name
                                        ? <span className="sync-role">{c.name}</span>
                                        : <span className="sync-role is-unknown" tabIndex={0} data-tip="Unbekannte Kategorie" data-tip-sub={`Kategorie-ID ${c.id} — auf dem Event-Discord nicht (mehr) gefunden.`}>Unbekannte Kategorie</span>}
                                    <span className="sync-muted">{reminderSummary(rule)}</span>
                                    {rule && rule.target !== "event" && <Badge tip="Wohin" tipSub={TARGET_TEXT[rule.target]}>{rule.target === "talk" ? "Talk" : "Beides"}</Badge>}
                                    {rule && rule.missingHours > 0 && c.roleCount === 0 && (
                                        <Badge tone="mid" tip="Keine Raider-Rolle" tipSub="Ohne Raider-Rolle der Kategorie weiß der Bot nicht, wer fehlt — die Erinnerung an Fehlende geht dann nicht raus.">keine Rolle</Badge>
                                    )}
                                    <span className="grow" />
                                    <IconButton size="sm" icon={<PenIcon />} tip="Erinnerungen bearbeiten" onClick={() => setEditing(c.id)} />
                                </li>
                            );
                        })}
                    </ul>
                )}

            {editingCategory && (
                <ReminderModal
                    name={editingCategory.name || "Unbekannte Kategorie"}
                    rule={data.categoryReminders[editingCategory.id] || OFF}
                    data={data}
                    onClose={() => setEditing(null)}
                    onSave={async (rule) => {
                        try {
                            const { config } = await updateSettings(csrfToken, remindersPatch(data.categoryReminders, editingCategory.id, rule) as Partial<AdminConfig>);
                            toast("Erinnerungen gespeichert.");
                            onConfig(config);
                            setEditing(null);
                            load();
                        } catch (err) {
                            toast((err as ApiError).message, "err");
                        }
                    }}
                />
            )}
        </section>
    );
}

/** The two hours and, with a talk server, where the reminders go. */
function ReminderModal({ name, rule, data, onClose, onSave }: {
    name: string;
    rule: ReminderRule;
    data: RemindersData;
    onClose: () => void;
    onSave: (rule: ReminderRule) => Promise<void>;
}) {
    const [missingHours, setMissingHours] = useState(rule.missingHours ? String(rule.missingHours) : "");
    const [signedHours, setSignedHours] = useState(rule.signedHours ? String(rule.signedHours) : "");
    const [target, setTarget] = useState<PingTarget>(rule.target);
    const [busy, setBusy] = useState(false);
    const targets = pingTargetOptions(data.pingTargets);

    const submit = async () => {
        setBusy(true);
        await onSave({ missingHours: Number(missingHours) || 0, signedHours: Number(signedHours) || 0, target: targets.length ? target : "event" });
        setBusy(false);
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="spell_holy_borrowedtime"
            tone="settings"
            kicker="Erinnerungen"
            title={name}
            width={480}
            initialFocus="input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
                    <Button onClick={submit} disabled={busy}>{busy ? "Speichert…" : "Speichern"}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="srv-channels">
                    <div className="dlg-field">
                        <FieldLabel htmlFor="rem-missing" tip="An Fehlende" tipSub="Stunden vor Anmeldeschluss (ohne Anmeldeschluss: vor Raidbeginn) an alle mit Raider-Rolle, die noch nicht reagiert haben. Leer = aus.">Fehlende · h vorher</FieldLabel>
                        <input id="rem-missing" type="number" min={0} max={168} step={1} value={missingHours} placeholder="aus" onChange={(e) => setMissingHours(e.target.value)} />
                    </div>
                    <div className="dlg-field">
                        <FieldLabel htmlFor="rem-signed" tip="An Angemeldete" tipSub="Stunden vor Raidbeginn an alle, die angemeldet sind (auch „kommt später“). Leer = aus.">Angemeldete · h vorher</FieldLabel>
                        <input id="rem-signed" type="number" min={0} max={168} step={1} value={signedHours} placeholder="aus" onChange={(e) => setSignedHours(e.target.value)} />
                    </div>
                </div>
                {targets.length > 0 && (
                    <div className="dlg-field">
                        <FieldLabel tip="Wohin" tipSub="Event-Kanal, Ping-Kanal des Kommunikations-Discords oder beides. Wer bei „Talk“ nicht auf dem Kommunikations-Discord ist, bekommt eine DM.">Wohin</FieldLabel>
                        <Segment<PingTarget> size="sm" ariaLabel="Wohin" options={targets} value={target} onChange={setTarget} />
                    </div>
                )}
            </div>
        </Modal>
    );
}
