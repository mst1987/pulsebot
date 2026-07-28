import { Link } from "react-router-dom";
import type { RaidRow } from "../api";
import { formatEventTime } from "../lib/format";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";

// Ported from renderAdmin.js's raidTable()/eventDetailLink()/logsCell()/lootCell()/
// linksCell() — shared by the History page's "Alle Raids" tab (upcoming + past).
// Only logs actually ASSIGNED to the raid are listed — the same stored
// assignment the event detail page reads, so the two can never disagree. A log
// that fits time-wise but stayed unassigned (two raids the same evening) shows
// up as an open decision instead, linking to the detail page's Logs tab.
function LogsCell({ ev }: { ev: RaidRow }) {
    const { logs } = ev;
    const pending = ev.pendingLogCount || 0;
    const pendingHint = pending ? (
        <div className="small">
            <Link className="mlink" to={`/raids/detail?event=${encodeURIComponent(ev.id)}&tab=logs`}>
                {pending} Log{pending === 1 ? "" : "s"} offen
            </Link>
        </div>
    ) : null;
    if (!logs.length) return pendingHint || <span className="sub">—</span>;
    return (
        <>
            {logs.map((l, i) => {
                const url = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
                const name = l.title || l.reportId || "(Log)";
                return (
                    <div key={i}>
                        {url
                            ? <a className="mlink" href={url} target="_blank" rel="noopener noreferrer">{name} ↗</a>
                            : name}
                        {l.status === "done" && (l.reportUrl || l.reportRefId) && (
                            <> · <a className="mlink" href={l.reportUrl || `/r/${l.reportRefId}`}>Auswertung</a></>
                        )}
                    </div>
                );
            })}
            {pendingHint}
        </>
    );
}

function LootCell({ ev }: { ev: RaidRow }) {
    return ev.lootCount
        ? <Link className="mlink" to={`/history/event?event=${encodeURIComponent(ev.id)}`}>{ev.lootCount} Items</Link>
        : <Link className="mlink" to="/history?tab=import">importieren</Link>;
}

function LinksCell({ ev, guildId }: { ev: RaidRow; guildId: string }) {
    const links: React.ReactNode[] = [];
    if (guildId && ev.channelId) {
        links.push(<a key="discord" className="mlink" href={eventPostUrl(guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer">Discord</a>);
    }
    links.push(<a key="setup" className="mlink" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer">Setup/Comp</a>);
    if (ev.softres?.url) {
        links.push(<a key="softres" className="mlink" href={ev.softres.url} target="_blank" rel="noopener noreferrer">Softres</a>);
    }
    return <>{links.map((l, i) => <span key={i}>{i > 0 && " · "}{l}</span>)}</>;
}

export default function RaidTable({ events, guildId, error, emptyMessage }: {
    events: RaidRow[];
    guildId: string;
    error: string | null;
    emptyMessage: string;
}) {
    if (error) {
        return <table className="idx" style={{ margin: 0 }}><tbody><tr><td colSpan={5} className="sub" style={{ padding: 16, color: "var(--high)" }}>{error}</td></tr></tbody></table>;
    }
    if (!events.length) {
        return <table className="idx" style={{ margin: 0 }}><tbody><tr><td colSpan={5} className="sub" style={{ padding: 16 }}>{emptyMessage}</td></tr></tbody></table>;
    }
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead><tr><th>Event</th><th>Termin</th><th>Logs</th><th>Loot</th><th>Links</th></tr></thead>
            <tbody>
                {events.map((ev) => (
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
