import { deleteHistoryLog, type ApiError, type LootLog } from "../../api";
import { formatEventTime, formatDate } from "../../lib/format";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { SortTh } from "../../components/SortTh";
import { ExternalIcon, TrashIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useConfirm } from "../../components/ui/Modal";
import { IconButton } from "../../components/ui/Button";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";
import { tParts, useT } from "../../i18n";

type LogSortKey = "log" | "date" | "zone" | "event" | "status";

const LOG_SORT_DEFAULTS: Record<LogSortKey, Dir> = { log: "asc", date: "desc", zone: "asc", event: "asc", status: "asc" };

export function LogsTab({ logs, onChanged }: { logs: LootLog[]; onChanged: (msg: string) => void }) {
    const t = useT();
    const ask = useConfirm();
    const { sort, dir, onSort, apply } = useTableSort<LogSortKey>("history-logs-sort", LOG_SORT_DEFAULTS, "date");
    const toast = useToast();

    const remove = async (l: LootLog) => {
        if (!(await ask({ title: t("history.logs.removeTitle"), text: t("history.logs.removeText", { name: l.title || l.reportId || t("history.logs.logFallback") }), action: t("common.remove") }))) return;
        try {
            await deleteHistoryLog(l.id);
            onChanged(t("history.logs.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const head = (
        <PartHead
            icon="inv_misc_pocketwatch_01" tone="history" title={t("history.page.view.logs")} crumb={t("history.logs.crumb")}
            tip={t("history.page.view.logs")} tipSub={t("history.logs.tipSub")}
            action={<Badge count>{tParts("history.logs.count", { count: logs.length })}</Badge>}
        />
    );

    if (!logs.length) return <div className="dash-card hl-card">{head}<div className="empty">{t("history.logs.empty")}</div></div>;

    const sorted = apply(logs, (l, key) => {
        switch (key) {
            case "log": return (l.title || l.reportId || "").toLowerCase();
            case "date": return l.postedAt || 0;
            case "zone": return (l.zone || "zzz").toLowerCase();
            // Unassigned logs are the ones that need work, so they lead the
            // ascending order instead of trailing the named ones.
            case "event": return (l.eventLabel || l.eventId || "").toLowerCase();
            case "status": return l.status === "done" ? 1 : 0;
            default: return "";
        }
    });

    return (
        <div className="dash-card hl-card">
            {head}
            <table className="idx flush">
                <thead>
                    <tr>
                        <SortTh sortKey="log" label={t("history.logs.colLog")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="date" label={t("history.shared.colDate")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="zone" label={t("history.logs.colZone")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="event" label={t("history.shared.colEvent")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="status" label={t("history.logs.colStatus")} sort={sort} dir={dir} onSort={onSort} tip={t("history.logs.colStatus")} tipSub={t("history.logs.statusSub")} />
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((l) => {
                        const wclUrl = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
                        const reportUrl = l.status === "done" && (l.reportUrl || l.reportRefId) ? (l.reportUrl || `/r/${l.reportRefId}`) : "";
                        return (
                            <tr key={l.id}>
                                <td>{wclUrl
                                    ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{l.title || l.reportId || t("history.logs.untitled")} ↗</a>
                                    : (l.title || t("history.logs.untitled"))}</td>
                                <td className="small">{formatDate(l.postedAt || 0)}</td>
                                <td className="small">{l.zone || ""}</td>
                                <td className="small">{l.eventId
                                    ? <Badge icon="inv_misc_note_02" tip={l.eventLabel || l.eventId} tipSub={l.eventStartTime ? formatEventTime(l.eventStartTime) : undefined}>{l.eventLabel || l.eventId}</Badge>
                                    : <span className="sub">—</span>}</td>
                                <td>{l.status === "done" ? <Badge tone="ok">{t("history.logs.done")}</Badge> : <Badge tone="mid">{t("history.logs.open")}</Badge>}</td>
                                <td className="cell-actions">
                                    <div className="row-actions is-end">
                                        {reportUrl && (
                                            <IconButton
                                                icon={<ExternalIcon />} size="sm" tip={t("history.shared.openEvaluation")}
                                                onClick={() => { window.location.href = reportUrl; }}
                                            />
                                        )}
                                        <IconButton icon={<TrashIcon />} tone="danger" size="sm" tip={t("history.logs.removeTip")} tipSub={t("history.logs.removeSub")} onClick={() => remove(l)} />
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
