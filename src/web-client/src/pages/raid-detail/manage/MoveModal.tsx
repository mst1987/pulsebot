// "Verschieben" (#288): a new date and time, and before anything happens the
// preview from the server — the new start large, what the channel will be
// called (and where that name comes from, #285), whether the deadline moves
// along and who is told. Two switches, one button.
import { useEffect, useState } from "react";
import { getMovePreview, moveRaid, type ApiError, type MovePlan } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { SwitchRow } from "../../../components/RaidPlanFields";
import { useToast } from "../../../components/Jobs";
import { berlinDateTime, moveChannelText, moveNotifyText } from "../../../lib/eventManage";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function MoveModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, csrfToken, onChanged } = ctx;
    const initial = berlinDateTime(data.event.startTime);
    const [date, setDate] = useState(initial.date);
    const [time, setTime] = useState(initial.time);
    const [plan, setPlan] = useState<MovePlan | null>(null);
    const [problem, setProblem] = useState("");
    const [loading, setLoading] = useState(false);
    const [rename, setRename] = useState(true);
    const [notify, setNotify] = useState(true);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (!open) return;
        const start = berlinDateTime(data.event.startTime);
        setDate(start.date);
        setTime(start.time);
        setRename(true);
        setNotify(true);
    }, [open, data.event.startTime]);

    // The preview follows the fields, a little behind the typing.
    useEffect(() => {
        if (!open || !date || !time) return undefined;
        let live = true;
        setLoading(true);
        const timer = window.setTimeout(() => {
            getMovePreview(eventId, date, time)
                .then((p) => { if (live) { setPlan(p); setProblem(""); } })
                .catch((err: ApiError) => { if (live) { setPlan(null); setProblem(err.message); } })
                .finally(() => { if (live) setLoading(false); });
        }, 300);
        return () => { live = false; window.clearTimeout(timer); };
    }, [open, eventId, date, time]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!plan) return;
        setBusy(true);
        try {
            const r = await moveRaid(csrfToken, { event: eventId, date, time, renameChannel: rename, notify });
            onClose();
            onChanged([r.message, ...(r.warnings || [])].join("\n"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const channel = plan ? moveChannelText(plan, rename) : null;
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_pocketwatch_02" tone="raids"
            kicker={data.event.title} title={t("raidManage.move.title")} width={560}
            hint={plan ? moveNotifyText(plan.recipients, notify) : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="em-move-form" icon="inv_misc_pocketwatch_02" running={busy} disabled={!plan || loading}>{t("raidManage.move.confirm")}</Button>
                </>
            )}
        >
            <form id="em-move-form" className="rd-form" onSubmit={submit}>
                <div className="em-fields">
                    <div className="field">
                        <label htmlFor="em-move-date">{t("raidManage.move.date")}</label>
                        <input id="em-move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                    <div className="field">
                        <label htmlFor="em-move-time">{t("raidManage.move.time")}</label>
                        <input id="em-move-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                    </div>
                </div>

                {problem && <div className="flash flash-err em-flash">{problem}</div>}

                {plan && channel && (
                    <div className={`em-preview${loading ? " is-loading" : ""}`}>
                        <div className="em-cell">
                            <span className="kicker">{t("raidManage.move.when")}</span>
                            <span className="em-val">{plan.to.label}</span>
                            <span className="em-sub">{t("raidManage.move.insteadOf", { from: plan.from.label })}</span>
                        </div>
                        <div className="em-cell">
                            <span className="kicker">{t("raidManage.move.channel")}</span>
                            <span className="em-val em-mono" data-tip={channel.value}>{channel.value}</span>
                            <span className="em-sub">
                                {channel.sub}
                                {plan.channel.label && (
                                    <Badge tone={plan.channel.rename ? "accent" : undefined} tip={plan.channel.label} tipSub={plan.channel.detail || undefined}>
                                        {plan.channel.rename ? t("raidManage.move.derived") : t("raidManage.move.nameStays")}
                                    </Badge>
                                )}
                            </span>
                        </div>
                        {plan.deadlineLabel && (
                            <div className="em-cell">
                                <span className="kicker">{t("raidManage.move.deadline")}</span>
                                <span className="em-val em-val-sm">{plan.deadlineLabel}</span>
                                <span className="em-sub">{t("raidManage.move.deadlineSub")}</span>
                            </div>
                        )}
                    </div>
                )}

                {plan && (
                    <div className="em-switches">
                        {plan.channel.rename && (
                            <SwitchRow
                                label={t("raidManage.move.rename")} checked={rename} onChange={setRename}
                                tip={t("raidManage.move.renameTip", { current: plan.channel.current, next: plan.channel.next })}
                            />
                        )}
                        {plan.recipients > 0 && (
                            <SwitchRow
                                label={t("raidManage.move.notifyLabel", { count: plan.recipients })} checked={notify} onChange={setNotify}
                                tip={t("raidManage.move.notifyTip")}
                            />
                        )}
                    </div>
                )}
            </form>
        </Modal>
    );
}
