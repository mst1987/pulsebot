import { Link } from "react-router-dom";
import type { RaidRow } from "../api";
import { formatEventTime } from "../lib/format";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";
import { useTableSort, type Dir } from "../lib/tableSort";
import { SortTh } from "./SortTh";
import { useT } from "../i18n";

// The link column is the only one that isn't sorted: its cells are the same
// two or three buttons on every row, so there is nothing to order by.
type SortKey = "event" | "time" | "logs" | "loot";
const SORT_DEFAULTS: Record<SortKey, Dir> = { event: "asc", time: "desc", logs: "desc", loot: "desc" };

// Ported from renderAdmin.js's raidTable()/eventDetailLink()/logsCell()/lootCell()/
// linksCell() — shared by the History page's "Alle Raids" tab (upcoming + past).
// Only logs actually ASSIGNED to the raid are listed — the same stored
// assignment the event detail page reads, so the two can never disagree. A log
// that fits time-wise but stayed unassigned (two raids the same evening) shows
// up as an open decision instead, linking to the detail page's Logs tab.
function LogsCell({ ev }: { ev: RaidRow }) {
    const t = useT();
    const { logs } = ev;
    const pending = ev.pendingLogCount || 0;
    const pendingHint = pending ? (
        <div className="small">
            <Link className="mlink" to={`/raids/detail?event=${encodeURIComponent(ev.id)}&tab=logs`}>
                {t("raids.table.pendingLogs", { count: pending })}
            </Link>
        </div>
    ) : null;
    if (!logs.length) return pendingHint || <span className="sub">—</span>;
    return (
        <>
            {logs.map((l, i) => {
                const url = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
                const name = l.title || l.reportId || t("raids.table.logFallback");
                return (
                    <div key={i}>
                        {url
                            ? <a className="mlink" href={url} target="_blank" rel="noopener noreferrer">{name} ↗</a>
                            : name}
                        {l.status === "done" && (l.reportUrl || l.reportRefId) && (
                            <> · <a className="mlink" href={l.reportUrl || `/r/${l.reportRefId}`}>{t("raids.table.report")}</a></>
                        )}
                    </div>
                );
            })}
            {pendingHint}
        </>
    );
}

function LootCell({ ev }: { ev: RaidRow }) {
    const t = useT();
    return ev.lootCount
        ? <Link className="mlink" to={`/history/event?event=${encodeURIComponent(ev.id)}`}>{t("raids.table.items", { count: ev.lootCount })}</Link>
        : <Link className="mlink" to="/history?tab=import">{t("raids.table.import")}</Link>;
}

function LinksCell({ ev, guildId }: { ev: RaidRow; guildId: string }) {
    const t = useT();
    const links: React.ReactNode[] = [];
    if (guildId && ev.channelId) {
        links.push(<a key="discord" className="mlink" href={eventPostUrl(guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer">Discord</a>);
    }
    if (raidplanUrl(ev.id)) {
        links.push(<a key="setup" className="mlink" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer">{t("raids.list.setup")}</a>);
    }
    if (ev.softres?.url) {
        links.push(<a key="softres" className="mlink" href={ev.softres.url} target="_blank" rel="noopener noreferrer">Softres</a>);
    }
    return <>{links.map((l, i) => <span key={i}>{i > 0 && " · "}{l}</span>)}</>;
}

export default function RaidTable({ events, guildId, error, emptyMessage, sortKey = "raid-table-sort", initialDir = "desc" }: {
    events: RaidRow[];
    guildId: string;
    error: string | null;
    emptyMessage: string;
    /** Storage key for the remembered sort. The upcoming and the past raids are
     *  two lists of the same shape shown at once, so each keeps its own. */
    sortKey?: string;
    /** Which end of the "Termin" column the list starts at: a list of coming
     *  raids leads with the next one, a list of past ones with the latest. */
    initialDir?: Dir;
}) {
    const t = useT();
    const { sort, dir, onSort, apply } = useTableSort<SortKey>(sortKey, SORT_DEFAULTS, "time", initialDir);
    const sorted = apply(events, (ev, key) => {
        switch (key) {
            case "event": return (ev.title || ev.id).toLowerCase();
            case "time": return ev.startTime || 0;
            // Logs and loot are counts in disguise: a raid with three logs
            // ranks above one with a single one, an unanalysed one last.
            case "logs": return (ev.logs?.length || 0) + (ev.pendingLogCount || 0);
            case "loot": return ev.lootCount || 0;
            default: return "";
        }
    });

    if (error) {
        return <table className="idx" style={{ margin: 0 }}><tbody><tr><td colSpan={5} className="sub" style={{ padding: 16, color: "var(--high)" }}>{error}</td></tr></tbody></table>;
    }
    if (!events.length) {
        return <table className="idx" style={{ margin: 0 }}><tbody><tr><td colSpan={5} className="sub" style={{ padding: 16 }}>{emptyMessage}</td></tr></tbody></table>;
    }
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead>
                <tr>
                    <SortTh sortKey="event" label={t("raids.table.event")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="time" label={t("raids.table.time")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="logs" label={t("raids.table.logs")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="loot" label={t("raids.table.loot")} sort={sort} dir={dir} onSort={onSort} />
                    <th>{t("raids.table.links")}</th>
                </tr>
            </thead>
            <tbody>
                {sorted.map((ev) => (
                    <tr key={ev.id}>
                        <td>
                            <strong><Link className="mlink" to={`/raids/detail?event=${encodeURIComponent(ev.id)}`}>{ev.title || ev.id}</Link></strong>
                            {ev.channelName && <div className="small">#{ev.channelName}</div>}
                        </td>
                        <td className="small">{formatEventTime(ev.startTime)}</td>
                        <td className="small"><LogsCell ev={ev} /></td>
                        <td className="small"><LootCell ev={ev} /></td>
                        <td className="small"><LinksCell ev={ev} guildId={guildId} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
