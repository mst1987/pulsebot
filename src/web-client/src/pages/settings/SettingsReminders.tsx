import { useEffect, useState } from "react";
import {
    getReminders, updateSettings,
    type AdminConfig, type ApiError, type ReminderRule, type RemindersData,
} from "../../api";
import { reminderOff, reminderSummary, remindersPatch } from "../../lib/settings/settingsLogic";
import { useT } from "../../i18n";
import { useToast } from "../../components/shell/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import PartHead from "../../components/ui/PartHead";
import RaidLoader from "../../components/ui/RaidLoader";
import Field from "../../components/ui/Field";
import { PenIcon, SaveIcon } from "../../components/ui/icons";

// Einstellungen → Verbindungen → Discord-Server, part "Erinnerungen" (#264).
// One line per raid category: its name, what is set as one short line, and a
// pen that opens the dialog. The rules themselves live in src/web/reminders.js.

const OFF: ReminderRule = { missingHours: 0, signedHours: 0 };

export default function RemindersPart({ onConfig }: {
    onConfig: (config: AdminConfig) => void;
}) {
    const [data, setData] = useState<RemindersData | null>(null);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<string | null>(null);
    const toast = useToast();
    const t = useT();

    const load = () => {
        getReminders().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
    };
    useEffect(load, []);

    const head = (
        <PartHead
            variant="plain"
            title={t("settings.reminders.title")}
            tip={t("settings.reminders.tip")}
            tipSub={t("settings.reminders.tipSub")}
        />
    );

    if (error) return <section className="sync-part">{head}<div className="empty">{error}</div></section>;
    if (!data) return <section className="sync-part">{head}<RaidLoader compact text={t("settings.reminders.loading")} /></section>;

    const editingCategory = editing ? data.categories.find((c) => c.id === editing) : null;

    return (
        <section className="sync-part">
            {head}
            {data.categories.length === 0
                ? <div className="sync-empty">{t("settings.reminders.empty")}</div>
                : (
                    <ul className="sync-list">
                        {data.categories.map((c) => {
                            const rule = data.categoryReminders[c.id];
                            const off = reminderOff(rule);
                            return (
                                <li key={c.id} className={`sync-row${off ? " is-off" : ""}`}>
                                    {/* A category the bot cannot see (deleted, other server) has no name: say so
                                        instead of showing an 18-digit id; the id stays in the tooltip. */}
                                    {c.name
                                        ? <span className="sync-role">{c.name}</span>
                                        : <span className="sync-role is-unknown" tabIndex={0} data-tip={t("settings.reminders.unknownCategory")} data-tip-sub={t("settings.reminders.unknownCategorySub", { id: c.id })}>{t("settings.reminders.unknownCategory")}</span>}
                                    <span className="sync-muted">{reminderSummary(rule)}</span>
                                    {/* #744: a deactivated category keeps its rule, but reminds nobody until it is active again */}
                                    {!off && c.active === false && (
                                        <Badge tone="mid" tip={t("settings.reminders.inactiveTip")} tipSub={t("settings.reminders.inactiveSub")}>{t("settings.reminders.inactive")}</Badge>
                                    )}
                                    {rule && rule.missingHours > 0 && c.roleCount === 0 && (
                                        <Badge tone="mid" tip={t("settings.reminders.noRole")} tipSub={t("settings.reminders.noRoleSub")}>{t("settings.reminders.noRoleBadge")}</Badge>
                                    )}
                                    <span className="grow" />
                                    <IconButton size="sm" icon={<PenIcon />} tip={t("settings.reminders.edit")} onClick={() => setEditing(c.id)} />
                                </li>
                            );
                        })}
                    </ul>
                )}

            {editingCategory && (
                <ReminderModal
                    name={editingCategory.name || t("settings.reminders.unknownCategory")}
                    rule={data.categoryReminders[editingCategory.id] || OFF}
                    onClose={() => setEditing(null)}
                    onSave={async (rule) => {
                        try {
                            const { config } = await updateSettings(remindersPatch(data.categoryReminders, editingCategory.id, rule) as Partial<AdminConfig>);
                            toast(t("settings.reminders.saved"));
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

/** The two hours; the reminders go to the raid's own server, the rest by DM (#894). */
function ReminderModal({ name, rule, onClose, onSave }: {
    name: string;
    rule: ReminderRule;
    onClose: () => void;
    onSave: (rule: ReminderRule) => Promise<void>;
}) {
    const [missingHours, setMissingHours] = useState(rule.missingHours ? String(rule.missingHours) : "");
    const [signedHours, setSignedHours] = useState(rule.signedHours ? String(rule.signedHours) : "");
    const [busy, setBusy] = useState(false);
    const t = useT();

    const submit = async () => {
        setBusy(true);
        await onSave({ missingHours: Number(missingHours) || 0, signedHours: Number(signedHours) || 0 });
        setBusy(false);
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="notify"
            tone="settings"
            kicker={t("settings.reminders.title")}
            title={name}
            width={480}
            initialFocus="input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} onClick={submit} disabled={busy}>{busy ? t("settings.saving") : t("common.save")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="srv-channels">
                    <Field className="dlg-field" htmlFor="rem-missing" label={t("settings.reminders.missing")} tip={t("settings.reminders.missingTip")} tipSub={t("settings.reminders.missingSub")}>
                        <input id="rem-missing" type="number" min={0} max={168} step={1} value={missingHours} placeholder={t("settings.reminderSummary.off")} onChange={(e) => setMissingHours(e.target.value)} />
                    </Field>
                    <Field className="dlg-field" htmlFor="rem-signed" label={t("settings.reminders.signed")} tip={t("settings.reminders.signedTip")} tipSub={t("settings.reminders.signedSub")}>
                        <input id="rem-signed" type="number" min={0} max={168} step={1} value={signedHours} placeholder={t("settings.reminderSummary.off")} onChange={(e) => setSignedHours(e.target.value)} />
                    </Field>
                </div>
            </div>
        </Modal>
    );
}
