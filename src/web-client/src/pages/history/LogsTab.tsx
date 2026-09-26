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

type LogSortKey = "log" | "date" | "zone" | "event" | "status";

const LOG_SORT_DEFAULTS: Record<LogSortKey, Dir> = { log: "asc", date: "desc", zone: "asc", event: "asc", status: "asc" };

export function LogsTab({ logs, onChanged }: { logs: LootLog[]; onChanged: (msg: string) => void }) {
    const ask = useConfirm();
    const { sort, dir, onSort, apply } = useTableSort<LogSortKey>("history-logs-sort", LOG_SORT_DEFAULTS, "date");
    const toast = useToast();

    const remove = async (l: LootLog) => {
        if (!(await ask({ title: "Log entfernen?", text: `„${l.title || l.reportId || "Log"}" wird aus der Liste entfernt.`, action: "Entfernen" }))) return;
        try {
            await deleteHistoryLog(l.id);
            onChanged("Gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const head = (
        <PartHead
            icon="inv_misc_pocketwatch_01" tone="history" title="Warcraft Logs" crumb="Raids & Logs › Warcraft Logs"
            tip="Warcraft Logs" tipSub="Die in den Log-Channels geposteten Logs. Log-Channels werden in den Einstellungen konfiguriert."
            action={<Badge count>{logs.length} Logs</Badge>}
        />
    );

    if (!logs.length) return <div className="dash-card hl-card">{head}<div className="empty">Keine Warcraft-Logs erfasst (Log-Channels in den Einstellungen konfigurieren).</div></div>;

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
            <table className="idx" style={{ margin: 0 }}>
                <thead>
                    <tr>
                        <SortTh sortKey="log" label="Log" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="date" label="Datum" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="zone" label="Zone" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="event" label="Event" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="status" label="Status" sort={sort} dir={dir} onSort={onSort} tip="Status" tipSub="Ausgewertet heißt: eine Log-Auswertung liegt vor und kann geöffnet werden." />
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
                                    ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{l.title || l.reportId || "(Log)"} ↗</a>
                                    : (l.title || "(Log)")}</td>
                                <td className="small">{formatDate(l.postedAt || 0)}</td>
                                <td className="small">{l.zone || ""}</td>
                                <td className="small">{l.eventId
                                    ? <Badge icon="inv_misc_note_02" tip={l.eventLabel || l.eventId} tipSub={l.eventStartTime ? formatEventTime(l.eventStartTime) : undefined}>{l.eventLabel || l.eventId}</Badge>
                                    : <span className="sub">—</span>}</td>
                                <td>{l.status === "done" ? <Badge tone="ok">ausgewertet</Badge> : <Badge tone="mid">offen</Badge>}</td>
                                <td className="cell-actions">
                                    <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                        {reportUrl && (
                                            <IconButton
                                                icon={<ExternalIcon />} size="sm" tip="Auswertung öffnen"
                                                onClick={() => { window.location.href = reportUrl; }}
                                            />
                                        )}
                                        <IconButton icon={<TrashIcon />} tone="danger" size="sm" tip="Log entfernen" tipSub="Nur aus dieser Liste — mit Rückfrage." onClick={() => remove(l)} />
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
