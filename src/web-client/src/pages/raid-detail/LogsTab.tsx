// Tab "Logs": the Warcraft Logs assigned to this raid, one row each — title and
// report id, which analysis is there and which is missing, and icon buttons for
// opening, discarding and unlinking. Assigning another log is the dialog.
import { useState } from "react";
import type { LogSection, RaidLogRow } from "../../api";
import { resetEval, unlinkLog, type ApiError } from "../../api";
import { PartHead } from "../../components/ui/PartHead";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import { useConfirm } from "../../components/ui/Modal";
import { CheckIcon, ExternalIcon, RefreshIcon, XIcon } from "../../components/icons";
import { LOG_ANALYSES, type RaidCtx } from "./meta";
import type { Evaluator } from "./useEvaluate";
import { useT } from "../../i18n";

export default function LogsTab({ ctx, evaluator }: { ctx: RaidCtx; evaluator: Evaluator }) {
    const t = useT();
    const { data, csrfToken, onChanged, openModal } = ctx;
    const ask = useConfirm();
    const [unlinkBusyId, setUnlinkBusyId] = useState("");
    const logs = data.eventLogs;

    const reset = async (l: RaidLogRow, section: LogSection) => {
        const label = section.toUpperCase();
        if (!(await ask({ title: t("raidDetail.logs.resetTitle", { label }), text: t("raidDetail.logs.resetText"), action: t("raidDetail.logs.resetAction") }))) return;
        try {
            const r = await resetEval(csrfToken, l.id, section);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    const unlink = async (l: RaidLogRow) => {
        if (!(await ask({ title: t("raidDetail.logs.unlinkTitle"), text: t("raidDetail.logs.unlinkText"), action: t("raidDetail.logs.unlinkAction") }))) return;
        setUnlinkBusyId(l.id);
        try {
            const r = await unlinkLog(csrfToken, l.id);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setUnlinkBusyId("");
        }
    };

    return (
        <section className="panel rd-panel">
            <PartHead
                icon="inv_misc_pocketwatch_01"
                tone="cla"
                title={t("raidDetail.logs.title")}
                crumb={`${data.event.title || "Raid"} · ${logs.length ? t("raidDetail.logs.assigned", { count: logs.length }) : t("raidDetail.logs.noneAssigned")}`}
                action={<Button variant="ghost" size="sm" icon="inv_misc_pocketwatch_01" onClick={() => openModal("log")}>{t("raidDetail.logs.assign")}</Button>}
            />

            {!logs.length ? (
                <p className="rd-empty">{t("raidDetail.logs.empty")}</p>
            ) : (
                <div className="rd-glist">
                    <div className="rd-log-row rd-loot-th" aria-hidden="true"><span>{t("raidDetail.logs.colLog")}</span><span>{t("raidDetail.logs.colEvaluation")}</span><span className="rd-right">{t("raidDetail.logs.colAction")}</span></div>
                    {logs.map((l) => {
                        const done = l.sections || [];
                        const wclUrl = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
                        const reportHref = l.reportUrl || (l.reportRefId ? `/r/${l.reportRefId}` : "");
                        const open = LOG_ANALYSES.filter((a) => !done.includes(a.key));
                        return (
                            <div key={l.id} className="rd-log-row">
                                <span className="rd-log-title">
                                    <IconTile icon="inv_misc_pocketwatch_01" tone="cla" />
                                    <span>
                                        <b>{l.title || l.reportId || t("raidDetail.logs.unknown")}</b>
                                        <span className="rd-mono">{l.reportId || t("raidDetail.logs.noReportId")}</span>
                                    </span>
                                </span>
                                <span className="rd-log-badges">
                                    {LOG_ANALYSES.map((a) => (done.includes(a.key)
                                        ? <Badge key={a.key} tone="ok" icon={<CheckIcon />} tip={t("raidDetail.logs.evaluatedTip", { label: a.label })} tipSub={a.tip}>{a.label}</Badge>
                                        : <Badge key={a.key} tone="mid" tip={t("raidDetail.logs.notEvaluatedTip", { label: a.label })} tipSub={a.tip}>{t("raidDetail.logs.open", { label: a.label })}</Badge>))}
                                </span>
                                <span className="rd-log-actions">
                                    {open.map((a) => (
                                        <Button
                                            key={a.key} variant="run" size="sm" icon="inv_misc_pocketwatch_01"
                                            running={evaluator.isRunning(l.id, a.key)}
                                            data-tip={t("raidDetail.logs.evaluate", { label: a.label })} data-tip-sub={a.tip}
                                            onClick={() => evaluator.evaluate(l, a.key)}
                                        >
                                            {t("raidDetail.logs.evaluate", { label: a.label })}
                                        </Button>
                                    ))}
                                    {reportHref && (
                                        <a className="ibtn sm" href={reportHref} data-tip={t("raidDetail.logs.openReport")} data-tip-sub={t("raidDetail.logs.openReportSub")} aria-label={t("raidDetail.logs.openReport")}>
                                            <ExternalIcon />
                                        </a>
                                    )}
                                    {!reportHref && wclUrl && (
                                        <a className="ibtn sm" href={wclUrl} target="_blank" rel="noopener noreferrer" data-tip={t("raidDetail.logs.openWcl")} aria-label={t("raidDetail.logs.openWcl")}>
                                            <ExternalIcon />
                                        </a>
                                    )}
                                    {done.map((key) => (
                                        <IconButton
                                            key={key} size="sm" tone="danger" icon={<RefreshIcon />}
                                            tip={t("raidDetail.logs.resetTip", { label: key.toUpperCase() })} tipSub={t("raidDetail.logs.resetSub")}
                                            onClick={() => reset(l, key as LogSection)}
                                        />
                                    ))}
                                    <IconButton
                                        size="sm" tone="danger" icon={<XIcon />} tip={t("raidDetail.logs.unlinkTip")} tipSub={t("raidDetail.logs.unlinkSub")}
                                        disabled={unlinkBusyId === l.id} onClick={() => unlink(l)}
                                    />
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
