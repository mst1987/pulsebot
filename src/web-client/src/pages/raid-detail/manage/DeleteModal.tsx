// "Löschen": an own event goes for good — its signups, its messages in the
// channel. Two cells say what goes and what stays (logs and loot keep the
// raid's name), the switches are off by default (mostly test or mistaken events
// are deleted), and a raid that already started wants one more switch, because
// its signups are its attendance. Afterwards the page leads back to the raid list.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRaid, getManageInfo, type ApiError } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { SwitchRow } from "../../../components/RaidPlanFields";
import { useToast } from "../../../components/Jobs";
import { deleteLines, deleteReady, deleteSummary } from "../../../lib/eventManage";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function DeleteModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId } = ctx;
    const [notify, setNotify] = useState(false);
    const [archive, setArchive] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const navigate = useNavigate();

    // Asked each time the dialog opens; a failed load is a toast, the dialog stays.
    const infoData = useApi(() => getManageInfo(eventId), [eventId], { enabled: open });
    const info = infoData.data;
    useEffect(() => { if (infoData.error) toast(infoData.error.message, "err"); }, [infoData.error, toast]);
    useEffect(() => {
        if (!open) return;
        setNotify(false);
        setArchive(false);
        setConfirmed(false);
    }, [open]);

    const d = info ? info.deletion : null;
    const lines = d ? deleteLines(d) : { gone: [], stays: [] };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!deleteReady(d, confirmed)) return;
        setBusy(true);
        try {
            const r = await deleteRaid({ event: eventId, notify: !!d && d.canNotify && notify, archiveChannel: archive, confirmStarted: confirmed });
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
            kicker={data.event.title} title={t("raidManage.delete.title")} width={520}
            hint={d ? deleteSummary(d, notify, archive) : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="em-delete-form" variant="danger" running={busy} disabled={!deleteReady(d, confirmed)}>{t("raidManage.delete.confirm")}</Button>
                </>
            )}
        >
            <form id="em-delete-form" className="rd-form" onSubmit={submit}>
                <div className={`em-preview${d ? "" : " is-loading"}`}>
                    <div className="em-cell">
                        <span className="em-sub">{t("raidManage.delete.gone")}</span>
                        <span className="em-val em-val-sm">{lines.gone[0] || "…"}</span>
                        {lines.gone.length > 1 && <span className="em-sub">{lines.gone.slice(1).join(" · ")}</span>}
                    </div>
                    <div className="em-cell" data-tip={t("raidManage.delete.staysTip")} data-tip-sub={t("raidManage.delete.staysTipSub")}>
                        <span className="em-sub">{t("raidManage.delete.stays")}</span>
                        <span className="em-val em-val-sm">{lines.stays.length ? lines.stays.join(" · ") : t("raidManage.delete.theChannel")}</span>
                        {lines.stays.length > 0 && <span className="em-sub">{t("raidManage.delete.andChannel")}</span>}
                    </div>
                </div>
                <div className="em-switches">
                    {d && d.started && (
                        <div className="em-switch-line">
                            <SwitchRow
                                label={t("raidManage.delete.startedLabel")} checked={confirmed} onChange={setConfirmed}
                                tip={t("raidManage.delete.startedTip")}
                            />
                        </div>
                    )}
                    {d && d.canNotify && d.recipients > 0 && (
                        <div className="em-switch-line">
                            <SwitchRow
                                label={t("raidManage.delete.notifyLabel", { count: d.recipients })} checked={notify} onChange={setNotify}
                                tip={t("raidManage.delete.notifyTip")}
                            />
                        </div>
                    )}
                    <div className="em-switch-line">
                        {info && !info.archive.configured ? (
                            <span className="em-sub" data-tip={t("raidManage.archive.noneTip")} data-tip-sub={t("raidManage.archive.noneTipSub")}>
                                {t("raidManage.archive.none")}
                            </span>
                        ) : (
                            <SwitchRow
                                label={t("raidManage.archive.label")} checked={archive} onChange={setArchive}
                                tip={t("raidManage.archive.tipDelete")}
                            />
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
