// "Anmelde-Aufruf": posts a call-to-signup message from a template into the
// event channel and pings the chosen roles — or on the talk server, where a
// synced role becomes its talk counterpart and everyone else a mention or a DM (#264).
import { useState } from "react";
import { Link } from "react-router-dom";
import { notifyRaid, type ApiError, type PingTarget } from "../../../api";
import TargetField from "./TargetField";
import { targetHint } from "../../../lib/settingsLogic";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/Jobs";
import type { RaidCtx } from "../meta";

export default function NotifyModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken, onChanged } = ctx;
    const { notifyTemplates, roles, event: ev } = data;
    const [templateId, setTemplateId] = useState(notifyTemplates[0]?.id ?? "");
    const [roleIds, setRoleIds] = useState<string[]>([]);
    const [target, setTarget] = useState<PingTarget>("event");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const toggleRole = (id: string) => setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await notifyRaid(csrfToken, { event: eventId, templateId: templateId || notifyTemplates[0]?.id || "", channelId: ev.channelId, roleIds, target });
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const channel = ev.channelName || ev.channelId;
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_letter_15" tone="raids"
            kicker={ev.title} title="Anmelde-Aufruf" width={560}
            hint={targetHint(target, channel, data.pingTargets)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    {notifyTemplates.length > 0 && (
                        <Button type="submit" form="rd-notify-form" icon="inv_letter_15" running={busy}>Aufruf posten</Button>
                    )}
                </>
            )}
        >
            {!notifyTemplates.length ? (
                <p className="rd-empty">
                    Noch keine Aufruf-Vorlagen. Lege zuerst unter <Link className="mlink" to="/raids/templates">Aufruf-Vorlagen</Link> eine an.
                </p>
            ) : (
                <form id="rd-notify-form" className="rd-form" onSubmit={submit}>
                    <TargetField info={data.pingTargets} value={target} onChange={setTarget} />
                    <div className="field">
                        <label htmlFor="rd-notify-template">Vorlage</label>
                        <select id="rd-notify-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                            {notifyTemplates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label data-tip="Rollen pingen" data-tip-sub={target === "event"
                            ? "Die ausgewählten Rollen werden im Event-Channel angepingt."
                            : "Auf dem Kommunikations-Discord wird eine abgeglichene Rolle zu ihrem Gegenstück; Mitglieder anderer Rollen werden einzeln erwähnt, wer nicht dort ist, bekommt eine DM (nur bei „Talk“)."} className="tipped">Rollen pingen</label>
                        {roles.length
                            ? (
                                <div className="rd-checks">
                                    {roles.map((r) => (
                                        <label key={r.id} className={`rd-check${roleIds.includes(r.id) ? " on" : ""}`}>
                                            <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                                            @{r.name}
                                        </label>
                                    ))}
                                </div>
                            )
                            : <p className="rd-empty">Keine Rollen gefunden (Server gewählt?).</p>}
                    </div>
                </form>
            )}
        </Modal>
    );
}
