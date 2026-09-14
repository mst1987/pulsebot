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

export default function LogsTab({ ctx, evaluator }: { ctx: RaidCtx; evaluator: Evaluator }) {
    const { data, csrfToken, onChanged, openModal } = ctx;
    const ask = useConfirm();
    const [unlinkBusyId, setUnlinkBusyId] = useState("");
    const logs = data.eventLogs;

    const reset = async (l: RaidLogRow, section: LogSection) => {
        const label = section.toUpperCase();
        if (!(await ask({ title: `${label}-Auswertung verwerfen?`, text: "Die Auswertung dieses Logs wird verworfen und kann danach neu gestartet werden.", action: "Verwerfen" }))) return;
        try {
            const r = await resetEval(csrfToken, l.id, section);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    const unlink = async (l: RaidLogRow) => {
        if (!(await ask({ title: "Zuordnung lösen?", text: "Das Log wird von diesem Raid gelöst und steht danach wieder unter den nicht zugeordneten Logs.", action: "Lösen" }))) return;
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
                title="Logs"
                crumb={`${data.event.title || "Raid"} · ${logs.length ? `${logs.length} ${logs.length === 1 ? "Log" : "Logs"} zugeordnet` : "noch kein Log zugeordnet"}`}
                action={<Button variant="ghost" size="sm" icon="inv_misc_pocketwatch_01" onClick={() => openModal("log")}>Log zuordnen</Button>}
            />

            {!logs.length ? (
                <p className="rd-empty">Nach dem Raid ein erkanntes Log oder einen Warcraft-Logs-Link diesem Raid zuordnen.</p>
            ) : (
                <div className="rd-glist">
                    <div className="rd-log-row rd-loot-th" aria-hidden="true"><span>Log</span><span>Auswertung</span><span className="rd-right">Aktion</span></div>
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
                                        <b>{l.title || l.reportId || "(unbekannt)"}</b>
                                        <span className="rd-mono">{l.reportId || "ohne Report-ID"}</span>
                                    </span>
                                </span>
                                <span className="rd-log-badges">
                                    {LOG_ANALYSES.map((a) => (done.includes(a.key)
                                        ? <Badge key={a.key} tone="ok" icon={<CheckIcon />} tip={`${a.label} · ausgewertet`} tipSub={a.tip}>{a.label}</Badge>
                                        : <Badge key={a.key} tone="mid" tip={`${a.label} · noch nicht ausgewertet`} tipSub={a.tip}>{a.label} offen</Badge>))}
                                </span>
                                <span className="rd-log-actions">
                                    {open.map((a) => (
                                        <Button
                                            key={a.key} variant="run" size="sm" icon="inv_misc_pocketwatch_01"
                                            running={evaluator.isRunning(l.id, a.key)}
                                            data-tip={`${a.label} auswerten`} data-tip-sub={a.tip}
                                            onClick={() => evaluator.evaluate(l, a.key)}
                                        >
                                            {a.label} auswerten
                                        </Button>
                                    ))}
                                    {reportHref && (
                                        <a className="ibtn sm" href={reportHref} data-tip="Report öffnen" data-tip-sub="Die Auswertungsseite dieses Logs" aria-label="Report öffnen">
                                            <ExternalIcon />
                                        </a>
                                    )}
                                    {!reportHref && wclUrl && (
                                        <a className="ibtn sm" href={wclUrl} target="_blank" rel="noopener noreferrer" data-tip="Auf Warcraft Logs öffnen" aria-label="Auf Warcraft Logs öffnen">
                                            <ExternalIcon />
                                        </a>
                                    )}
                                    {done.map((key) => (
                                        <IconButton
                                            key={key} size="sm" tone="danger" icon={<RefreshIcon />}
                                            tip={`${key.toUpperCase()}-Auswertung verwerfen`} tipSub="Kann danach neu gestartet werden."
                                            onClick={() => reset(l, key as LogSection)}
                                        />
                                    ))}
                                    <IconButton
                                        size="sm" tone="danger" icon={<XIcon />} tip="Zuordnung lösen" tipSub="Das Log bleibt erhalten, nur nicht mehr an diesem Raid."
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
