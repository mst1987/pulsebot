import { useEffect, useState } from "react";
import { getDashboard, type ApiError, type DashboardData, type UpcomingEvent, type RecentEvent } from "../api";
import { formatEventTime, formatDate } from "../lib/format";
import { RecruitmentIcon, ClaIcon, RaidsIcon, ChannelsIcon, SettingsIcon } from "../components/icons";

function Tile({ label, value, sub, accent }: { label: string; value: number; sub: string; accent?: boolean }) {
    return (
        <div className={`tile${accent ? " accent" : ""}`}>
            <div className="t-label">{label}</div>
            <div className="t-value">{value || 0}</div>
            <div className="t-sub">{sub}</div>
        </div>
    );
}

function SheetBadge({ sheet }: { sheet: UpcomingEvent["sheet"] }) {
    if (!sheet) return <span className="pill">Sheet fehlt</span>;
    const when = formatDate(new Date(sheet.filledAt).getTime());
    const title = `Gefüllt am ${when}${sheet.playerCount ? ` · ${sheet.playerCount} Spieler` : ""}`;
    return <span className="pill good" title={title}>Sheet ✓</span>;
}

function UpcomingTable({ upcoming }: { upcoming: DashboardData["upcoming"] }) {
    if (upcoming.error) {
        return <tr><td colSpan={4} className="sub" style={{ padding: 16, color: "var(--high)" }}>{upcoming.error}</td></tr>;
    }
    if (!upcoming.events.length) {
        return <tr><td colSpan={4} className="sub" style={{ padding: 16 }}>Keine anstehenden Events mit fertigem Setup.</td></tr>;
    }
    return (
        <>
            {upcoming.events.map((ev) => (
                <tr key={ev.id}>
                    <td>{ev.title}</td>
                    <td className="small">{ev.channelName}</td>
                    <td className="small">{formatEventTime(ev.startTime)}</td>
                    <td><SheetBadge sheet={ev.sheet} /></td>
                </tr>
            ))}
        </>
    );
}

function LatestEventsTable({ recentEvents }: { recentEvents: DashboardData["recentEvents"] }) {
    if (recentEvents.error) {
        return <tr><td colSpan={3} className="sub" style={{ padding: 16, color: "var(--high)" }}>{recentEvents.error}</td></tr>;
    }
    if (!recentEvents.events.length) {
        return <tr><td colSpan={3} className="sub" style={{ padding: 16 }}>Keine vergangenen Events gefunden.</td></tr>;
    }
    return (
        <>
            {recentEvents.events.map((ev: RecentEvent) => (
                <tr key={ev.id}>
                    <td><strong>{ev.title}</strong>{ev.channelName && <div className="small">#{ev.channelName}</div>}</td>
                    <td className="small">{formatEventTime(ev.startTime)}</td>
                    <td className="small">{ev.logs.length ? `${ev.logs.length} Log(s)` : "—"}</td>
                </tr>
            ))}
        </>
    );
}

function RecentReportsTable({ reports }: { reports: DashboardData["recentReports"] }) {
    if (!reports.length) {
        return <tr><td colSpan={4} className="sub" style={{ padding: 16 }}>Noch keine Auswertungen.</td></tr>;
    }
    return (
        <>
            {reports.map((r) => (
                <tr key={r.id}>
                    <td><a className="mlink" href={`/r/${r.id}`}>{r.title || r.id}</a></td>
                    <td>{r.zone}</td>
                    <td className="small">{formatDate(r.generatedAt)}</td>
                    <td><span className="pill">{r.issueCount}</span></td>
                </tr>
            ))}
        </>
    );
}

const QUICK_LINKS = [
    { href: "/admin/recruitment", icon: <RecruitmentIcon />, label: "Recruitment verwalten" },
    { href: "/admin/cla", icon: <ClaIcon />, label: "Neue Log-Auswertung" },
    { href: "/admin/raids", icon: <RaidsIcon />, label: "Raid-Event anlegen" },
    { href: "/admin/channels", icon: <ChannelsIcon />, label: "Kanäle verwalten" },
    { href: "/admin/settings", icon: <SettingsIcon />, label: "Einstellungen" },
];

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);

    useEffect(() => {
        getDashboard()
            .then(setData)
            .catch((err: ApiError) => setError(err));
    }, []);

    if (error) {
        return <div className="empty">Fehler beim Laden des Dashboards: {error.message}</div>;
    }
    if (!data) {
        return <div className="empty">Lade…</div>;
    }

    const { stats } = data;

    return (
        <>
            <h1 className="page-title">Übersicht</h1>

            <div className="tiles">
                <Tile label="Log-Check-Auswertungen" value={stats.reportsTotal} sub={`${stats.reportsWithIssues} mit Problemen`} accent />
                <Tile label="Recruitment-Vorlagen" value={stats.templates} sub={`${stats.posts} gepostete Nachrichten`} />
                <Tile label="Event-Kategorien" value={stats.categories} sub="in den Einstellungen gepflegt" />
                <Tile label="Admin-Rollen" value={stats.adminRoles} sub={stats.adminRoles ? "konfiguriert" : "noch keine gesetzt"} />
            </div>

            <div className="dash-card">
                <div className="dash-card-head">
                    <h3>Upcoming Events</h3>
                    <a className="mlink" href="/admin/raids">Alle →</a>
                </div>
                <table className="idx">
                    <thead><tr><th>Event</th><th>Kanal</th><th>Termin</th><th>Sheet</th></tr></thead>
                    <tbody><UpcomingTable upcoming={data.upcoming} /></tbody>
                </table>
            </div>

            <div className="dash-card">
                <div className="dash-card-head">
                    <h3>Latest Events</h3>
                    <a className="mlink" href="/admin/history">Historie &amp; Loot →</a>
                </div>
                <table className="idx">
                    <thead><tr><th>Event</th><th>Termin</th><th>Logs</th></tr></thead>
                    <tbody><LatestEventsTable recentEvents={data.recentEvents} /></tbody>
                </table>
            </div>

            <div className="dash-grid">
                <div className="dash-card">
                    <div className="dash-card-head">
                        <h3>Letzte Auswertungen</h3>
                        <a className="mlink" href="/admin/cla">Alle →</a>
                    </div>
                    <table className="idx">
                        <thead><tr><th>Report</th><th>Zone</th><th>Erstellt</th><th>Probleme</th></tr></thead>
                        <tbody><RecentReportsTable reports={data.recentReports} /></tbody>
                    </table>
                </div>
                <div className="dash-card">
                    <div className="dash-card-head"><h3>Schnellzugriff</h3></div>
                    <div className="quick">
                        {QUICK_LINKS.map((q) => (
                            <a key={q.href} href={q.href}>
                                <span className="qi">{q.icon}</span>
                                {q.label}
                            </a>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
