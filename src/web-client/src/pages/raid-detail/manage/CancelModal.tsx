// "Absagen" (#288): a reason (it goes to the raiders), who gets a DM, whether
// the channel goes into the archive — and the foot says in one line what
// pressing the red button will do.
import { useEffect, useState } from "react";
import { cancelRaid, getManageInfo, type ApiError, type ManageInfo } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { SwitchRow } from "../../../components/RaidPlanFields";
import { useToast } from "../../../components/Jobs";
import { cancelReasonOk, cancelSummary } from "../../../lib/eventManage";
import type { RaidCtx } from "../meta";

export default function CancelModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken, onChanged } = ctx;
    const [info, setInfo] = useState<ManageInfo | null>(null);
    const [reason, setReason] = useState("");
    const [notify, setNotify] = useState(true);
    const [archive, setArchive] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (!open) return;
        setReason("");
        setNotify(true);
        setArchive(false);
        getManageInfo(eventId).then(setInfo).catch((err: ApiError) => toast(err.message, "err"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, eventId]);

    const recipients = info ? info.recipients.length : 0;
    const names = info ? info.recipients.map((r) => r.character || r.name || r.userId).join(", ") : "";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!cancelReasonOk(reason)) return;
        setBusy(true);
        try {
            const r = await cancelRaid(csrfToken, { event: eventId, reason, notify, archiveChannel: archive });
            onClose();
            onChanged([r.message, ...(r.warnings || [])].join("\n"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open} onClose={onClose} icon="ability_creature_cursed_02" tone="bad"
            kicker={data.event.title} title="Event absagen" width={520}
            hint={cancelSummary(recipients, notify, archive)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="em-cancel-form" variant="danger" running={busy} disabled={!info || !cancelReasonOk(reason)}>Absagen</Button>
                </>
            )}
        >
            <form id="em-cancel-form" className="rd-form" onSubmit={submit}>
                <div className="field">
                    <label htmlFor="em-cancel-reason">Grund <span className="rd-muted">geht an alle Angemeldeten</span></label>
                    <textarea
                        id="em-cancel-reason" value={reason} maxLength={300} rows={3} required
                        placeholder="Zu wenig Heiler, wir verschieben auf Donnerstag."
                        onChange={(e) => setReason(e.target.value)}
                    />
                </div>
                <div className="em-switches">
                    <div className="em-switch-line">
                        <SwitchRow
                            label="Angemeldete per DM informieren" checked={notify} onChange={setNotify}
                            tip="Jeder, der nicht abgemeldet ist, bekommt den Grund als Direktnachricht vom Bot."
                        />
                        <Badge tone={recipients ? "accent" : undefined} tip={`${recipients} Angemeldete`} tipSub={names || "Niemand angemeldet."}>{recipients}</Badge>
                    </div>
                    <div className="em-switch-line">
                        {info && !info.archive.configured ? (
                            <span className="em-sub" data-tip="Keine Archiv-Kategorie" data-tip-sub="Unter Kanäle → Archiv eine Archiv-Kategorie festlegen, dann lässt sich der Kanal hier mit archivieren.">
                                Kanal bleibt — keine Archiv-Kategorie festgelegt
                            </span>
                        ) : (
                            <SwitchRow
                                label="Kanal ins Archiv" checked={archive} onChange={setArchive}
                                tip="Der Kanal wandert in die Archiv-Kategorie und niemand kann mehr schreiben. Gelöscht wird nichts."
                            />
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
