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
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function CancelModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
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
            kicker={data.event.title} title={t("raidManage.cancel.title")} width={520}
            hint={cancelSummary(recipients, notify, archive)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="em-cancel-form" variant="danger" running={busy} disabled={!info || !cancelReasonOk(reason)}>{t("raidManage.cancel.confirm")}</Button>
                </>
            )}
        >
            <form id="em-cancel-form" className="rd-form" onSubmit={submit}>
                <div className="field">
                    <label htmlFor="em-cancel-reason">{t("raidManage.cancel.reason")} <span className="rd-muted">{t("raidManage.cancel.reasonSub")}</span></label>
                    <textarea
                        id="em-cancel-reason" value={reason} maxLength={300} rows={3} required
                        placeholder={t("raidManage.cancel.reasonPlaceholder")}
                        onChange={(e) => setReason(e.target.value)}
                    />
                </div>
                <div className="em-switches">
                    <div className="em-switch-line">
                        <SwitchRow
                            label={t("raidManage.cancel.notifyLabel")} checked={notify} onChange={setNotify}
                            tip={t("raidManage.cancel.notifyTip")}
                        />
                        <Badge tone={recipients ? "accent" : undefined} tip={t("raidManage.cancel.recipients", { count: recipients })} tipSub={names || t("raidManage.cancel.nobody")}>{recipients}</Badge>
                    </div>
                    <div className="em-switch-line">
                        {info && !info.archive.configured ? (
                            <span className="em-sub" data-tip={t("raidManage.archive.noneTip")} data-tip-sub={t("raidManage.archive.noneTipSub")}>
                                {t("raidManage.archive.none")}
                            </span>
                        ) : (
                            <SwitchRow
                                label={t("raidManage.archive.label")} checked={archive} onChange={setArchive}
                                tip={t("raidManage.archive.tipCancel")}
                            />
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
