// "Löschen": an own event goes for good — its signups, its messages in the
// channel. Two cells say what goes and what stays (logs and loot keep the
// raid's name), the switches are off by default (mostly test or mistaken events
// are deleted), and a raid that already started wants one more switch, because
// its signups are its attendance. Afterwards the page leads back to the raid list.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRaid, getManageInfo, type ApiError, type ManageInfo } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { SwitchRow } from "../../../components/RaidPlanFields";
import { useToast } from "../../../components/Jobs";
import { deleteLines, deleteReady, deleteSummary } from "../../../lib/eventManage";
import type { RaidCtx } from "../meta";

export default function DeleteModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken } = ctx;
    const [info, setInfo] = useState<ManageInfo | null>(null);
    const [notify, setNotify] = useState(false);
    const [archive, setArchive] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const navigate = useNavigate();

    useEffect(() => {
        if (!open) return;
        setNotify(false);
        setArchive(false);
        setConfirmed(false);
        getManageInfo(eventId).then(setInfo).catch((err: ApiError) => toast(err.message, "err"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, eventId]);

    const d = info ? info.deletion : null;
    const lines = d ? deleteLines(d) : { gone: [], stays: [] };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!deleteReady(d, confirmed)) return;
        setBusy(true);
        try {
            const r = await deleteRaid(csrfToken, { event: eventId, notify: !!d && d.canNotify && notify, archiveChannel: archive, confirmStarted: confirmed });
            onClose();
            toast([r.message, ...(r.warnings || [])].join("\n"), r.warnings && r.warnings.length ? "err" : "ok");
            navigate("/raids");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_bone_humanskull_01" tone="bad"
            kicker={data.event.title} title="Event löschen" width={520}
            hint={d ? deleteSummary(d, notify, archive) : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="em-delete-form" variant="danger" running={busy} disabled={!deleteReady(d, confirmed)}>Löschen</Button>
                </>
            )}
        >
            <form id="em-delete-form" className="rd-form" onSubmit={submit}>
                <div className={`em-preview${d ? "" : " is-loading"}`}>
                    <div className="em-cell">
                        <span className="em-sub">Geht verloren</span>
                        <span className="em-val em-val-sm">{lines.gone[0] || "…"}</span>
                        {lines.gone.length > 1 && <span className="em-sub">{lines.gone.slice(1).join(" · ")}</span>}
                    </div>
                    <div className="em-cell" data-tip="Bleibt erhalten" data-tip-sub="Logs und Loot tragen den Namen des Raids selbst und bleiben unter Historie & Loot. Der Kanal wird nie gelöscht.">
                        <span className="em-sub">Bleibt</span>
                        <span className="em-val em-val-sm">{lines.stays.length ? lines.stays.join(" · ") : "der Kanal"}</span>
                        {lines.stays.length > 0 && <span className="em-sub">und der Kanal</span>}
                    </div>
                </div>
                <div className="em-switches">
                    {d && d.started && (
                        <div className="em-switch-line">
                            <SwitchRow
                                label="Der Raid hat schon stattgefunden — trotzdem löschen" checked={confirmed} onChange={setConfirmed}
                                tip="Mit den Anmeldungen verschwindet die Anwesenheit dieses Raids aus Roster und Loot-Council."
                            />
                        </div>
                    )}
                    {d && d.canNotify && d.recipients > 0 && (
                        <div className="em-switch-line">
                            <SwitchRow
                                label={`${d.recipients} Angemeldete per DM informieren`} checked={notify} onChange={setNotify}
                                tip="Aus: niemand erfährt davon — richtig für Test- und Fehl-Events. An: jeder, der nicht abgemeldet ist, bekommt eine kurze DM."
                            />
                        </div>
                    )}
                    <div className="em-switch-line">
                        {info && !info.archive.configured ? (
                            <span className="em-sub" data-tip="Keine Archiv-Kategorie" data-tip-sub="Unter Kanäle → Archiv eine Archiv-Kategorie festlegen, dann lässt sich der Kanal hier mit archivieren.">
                                Kanal bleibt — keine Archiv-Kategorie festgelegt
                            </span>
                        ) : (
                            <SwitchRow
                                label="Kanal ins Archiv" checked={archive} onChange={setArchive}
                                tip="Der Kanal wandert in die Archiv-Kategorie und niemand kann mehr schreiben. Gelöscht wird er nie."
                            />
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
