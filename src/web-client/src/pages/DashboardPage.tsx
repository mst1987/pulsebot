import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, type ApiError, type DashboardData, type UpcomingEvent } from "../api";
import { formatEventTime, formatDate, fmtMs } from "../lib/format";
import { RecruitmentIcon, ClaIcon, RaidsIcon, ChannelsIcon, SettingsIcon } from "../components/icons";
import RaidTable from "../components/RaidTable";
import OrbsBackground from "../components/OrbsBackground";
import { CharacterLink } from "../components/ClassSpec";
import { LootResponseBadge } from "../components/LootTable";
import { itemQualityProps, itemQualityColor } from "../lib/itemQuality";
import type { ReactNode } from "react";

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

// The awards of items the guild flagged as "top" in Einstellungen → Loot. Every
// row is a highlight by definition — the card only ever holds top items — so it
// gets the star + accent treatment rather than a plain table row.
function TopLootList({ topLoot }: { topLoot: DashboardData["topLoot"] }) {
    if (!topLoot.items.length) {
        return (
            <p className="sub" style={{ padding: 16, margin: 0 }}>
                {topLoot.configured
                    ? `Noch keins der ${topLoot.configured} Top-Items vergeben.`
                    : <>Noch keine Top-Items festgelegt — <Link className="mlink" to="/settings">Einstellungen → Loot</Link>.</>}
            </p>
        );
    }
    return (
        <ul className="toploot">
            {topLoot.items.map((it) => (
                <li className="toploot-row" key={`${it.eventId}-${it.itemId}-${it.character}-${it.awardedAt}`}>
                    <span className="toploot-star" aria-hidden="true">★</span>
                    {it.itemIconUrl && (
                        <img
                            className="toploot-ico" src={it.itemIconUrl} alt="" loading="lazy"
                            style={{ borderColor: itemQualityColor(it.itemQuality) || "var(--line)" }}
                        />
                    )}
                    <span className="toploot-main">
                        {it.itemLink
                            ? <a {...itemQualityProps(it.itemQuality, "mlink")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                            : <span {...itemQualityProps(it.itemQuality)}>{it.itemName || `Item ${it.itemId}`}</span>}
                        <span className="toploot-meta small">
                            {[it.eventLabel, it.boss].filter(Boolean).join(" · ")}
                            {(it.eventLabel || it.boss) && " · "}
                            {fmtMs(it.awardedAt, false)}
                        </span>
                    </span>
                    <span className="toploot-who">
                        <CharacterLink character={it.character} />
                        <LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} />
                    </span>
                </li>
            ))}
        </ul>
    );
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

            <div className="dash-card">
                <div className="dash-card-head">
                    <h3>Upcoming Events</h3>
                    <Link className="mlink" to="/raids">Alle →</Link>
                </div>
                <table className="idx">
                    <thead><tr><th>Event</th><th>Kanal</th><th>Termin</th><th>Sheet</th></tr></thead>
                    <tbody><UpcomingTable upcoming={data.upcoming} /></tbody>
                </table>
            </div>

            <div className="dash-card">
                <div className="dash-card-head">
                    <h3>Latest Events</h3>
                    <Link className="mlink" to="/history">Historie &amp; Loot →</Link>
                </div>
                <RaidTable
                    events={data.recentEvents.events} guildId={data.activeGuildId}
                    error={data.recentEvents.error} emptyMessage="Keine vergangenen Events gefunden."
                />
            </div>

            <div className="dash-card">
                <div className="dash-card-head">
                    <h3>Latest Loot <span className="dash-card-sub">Top-Items</span></h3>
                    <Link className="mlink" to="/history">Historie &amp; Loot →</Link>
                </div>
                <TopLootList topLoot={data.topLoot} />
            </div>

            <div className="dash-grid">
                <div className="dash-card">
                    <div className="dash-card-head">
                        <h3>Letzte Auswertungen</h3>
                        <Link className="mlink" to="/cla">Alle →</Link>
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
