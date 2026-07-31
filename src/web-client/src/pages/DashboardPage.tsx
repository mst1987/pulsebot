import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, type ApiError, type DashboardData, type UpcomingEvent } from "../api";
import { formatEventTime, formatDate } from "../lib/format";
import {
    RecruitmentIcon, ClaIcon, RaidsIcon, ChannelsIcon, SettingsIcon, ClockIcon, LootIcon, BoltIcon,
} from "../components/icons";
import RaidTable from "../components/RaidTable";
import OrbsBackground from "../components/OrbsBackground";
import TopLootList from "../components/TopLootList";
import type { ReactNode } from "react";

// Every dashboard card wears the same head: an accented icon tile, the title,
// an optional kicker next to it, and the "go there" link pushed to the right.
function CardHead({ icon, title, kicker, link, linkLabel }: {
    icon: ReactNode; title: string; kicker?: string; link?: string; linkLabel?: string;
}) {
    return (
        <div className="dash-card-head">
            <span className="dch-icon">{icon}</span>
            <h3>{title}</h3>
            {kicker && <span className="dch-kicker">{kicker}</span>}
            {link && <Link className="mlink" to={link}>{linkLabel || "Alle"} →</Link>}
        </div>
    );
}

function Tile({ area, icon, label, value, sub, accent }: {
    area: string; icon: ReactNode; label: string; value: number; sub: string; accent?: boolean;
}) {
    return (
        <div className={`tile area-${area}${accent ? " accent" : ""}`}>
            <div className="t-icon">{icon}</div>
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
                    <td><Link className="mlink" to={`/raids/detail?event=${encodeURIComponent(ev.id)}`}>{ev.title}</Link></td>
                    <td className="small">{ev.channelName}</td>
                    <td className="small">{formatEventTime(ev.startTime)}</td>
                    <td><SheetBadge sheet={ev.sheet} /></td>
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

// The card's body: the newest top-item awards, rendered by the same list the
// Historie tab uses (components/TopLootList) — only the empty states are the
// card's own, since they point at where top items are defined.
function TopLootCard({ topLoot }: { topLoot: DashboardData["topLoot"] }) {
    if (!topLoot.items.length) {
        return (
            <p className="sub" style={{ padding: 16, margin: 0 }}>
                {topLoot.configured
                    ? `Noch keins der ${topLoot.configured} Top-Items vergeben.`
                    : <>Noch keine Top-Items festgelegt — <Link className="mlink" to="/settings">Einstellungen → Loot</Link>.</>}
            </p>
        );
    }
    return <TopLootList items={topLoot.items} />;
}

const QUICK_LINKS = [
    { href: "/recruitment", icon: <RecruitmentIcon />, label: "Recruitment verwalten" },
    { href: "/cla", icon: <ClaIcon />, label: "Neue Log-Auswertung" },
    { href: "/raids", icon: <RaidsIcon />, label: "Raid-Event anlegen" },
    { href: "/channels", icon: <ChannelsIcon />, label: "Kanäle verwalten" },
    { href: "/settings", icon: <SettingsIcon />, label: "Einstellungen" },
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

            {/* Top row: the four key figures as a 2x2 block on the left, the
                latest top-item awards next to them on the right. */}
            <div className="dash-top">
                <div className="dash-hero">
                    <OrbsBackground />
                    <div className="dash-hero-content">
                        <div className="tiles">
                            <Tile area="cla" icon={<ClaIcon />} label="Log-Check-Auswertungen" value={stats.reportsTotal} sub={`${stats.reportsWithIssues} mit Problemen`} accent />
                            <Tile area="recruitment" icon={<RecruitmentIcon />} label="Recruitment-Vorlagen" value={stats.templates} sub={`${stats.posts} gepostete Nachrichten`} />
                            <Tile area="channels" icon={<ChannelsIcon />} label="Event-Kategorien" value={stats.categories} sub="in den Einstellungen gepflegt" />
                            <Tile area="settings" icon={<SettingsIcon />} label="Admin-Rollen" value={stats.adminRoles} sub={stats.adminRoles ? "konfiguriert" : "noch keine gesetzt"} />
                        </div>
                    </div>
                </div>

                <div className="dash-card dash-loot">
                    <CardHead icon={<LootIcon />} title="Latest Loot" kicker="Top-Items" link="/history" linkLabel="Historie & Loot" />
                    <TopLootCard topLoot={data.topLoot} />
                </div>
            </div>

            <div className="dash-card">
                <CardHead icon={<ClockIcon />} title="Upcoming Events" link="/raids" />
                <table className="idx">
                    <thead><tr><th>Event</th><th>Kanal</th><th>Termin</th><th>Sheet</th></tr></thead>
                    <tbody><UpcomingTable upcoming={data.upcoming} /></tbody>
                </table>
            </div>

            <div className="dash-card">
                <CardHead icon={<RaidsIcon />} title="Latest Events" link="/history" linkLabel="Historie & Loot" />
                <RaidTable
                    events={data.recentEvents.events} guildId={data.activeGuildId}
                    error={data.recentEvents.error} emptyMessage="Keine vergangenen Events gefunden."
                />
            </div>

            <div className="dash-grid">
                <div className="dash-card">
                    <CardHead icon={<ClaIcon />} title="Letzte Auswertungen" link="/cla" />
                    <table className="idx">
                        <thead><tr><th>Report</th><th>Zone</th><th>Erstellt</th><th>Probleme</th></tr></thead>
                        <tbody><RecentReportsTable reports={data.recentReports} /></tbody>
                    </table>
                </div>
                <div className="dash-card">
                    <CardHead icon={<BoltIcon />} title="Schnellzugriff" />
                    <div className="quick">
                        {QUICK_LINKS.map((q) => (
                            <Link key={q.href} to={q.href}>
                                <span className="qi">{q.icon}</span>
                                {q.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
