import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import GuildSwitcher from "./GuildSwitcher";
import {
    CrestIcon, BurgerIcon, HomeIcon, RecruitmentIcon, ClaIcon, RaidsIcon, ChannelsIcon, SettingsIcon, HistoryIcon,
    RosterIcon,
} from "./icons";
import { canAccess, type SessionUser, type SessionGuild } from "../api";

export type ShellContext = { user: SessionUser; csrfToken: string | null };

// Same tab list/grouping as src/web/renderAdmin.js's TABS. `area` is the
// permission area from src/config/permissions.js: a tab only appears when the
// user's roles grant read access to it (the API enforces it for real, see
// src/web/apiAccess.js).
type Tab = { id: string; area: string; label: string; href: string; group: string; icon: ReactNode };
export const TABS: Tab[] = [
    { id: "home", area: "dashboard", label: "Übersicht", href: "/", group: "Verwaltung", icon: <HomeIcon /> },
    { id: "recruitment", area: "recruitment", label: "Recruitment", href: "/recruitment", group: "Verwaltung", icon: <RecruitmentIcon /> },
    { id: "cla", area: "cla", label: "CLA / Logcheck", href: "/cla", group: "Verwaltung", icon: <ClaIcon /> },
    { id: "raids", area: "raids", label: "Raid-Events", href: "/raids", group: "Verwaltung", icon: <RaidsIcon /> },
    { id: "roster", area: "roster", label: "Roster", href: "/roster", group: "Verwaltung", icon: <RosterIcon /> },
    { id: "history", area: "history", label: "Historie & Loot", href: "/history", group: "Verwaltung", icon: <HistoryIcon /> },
    { id: "channels", area: "channels", label: "Kanäle", href: "/channels", group: "Verwaltung", icon: <ChannelsIcon /> },
    { id: "settings", area: "settings", label: "Einstellungen", href: "/settings", group: "System", icon: <SettingsIcon /> },
];

/** The first tab the user may open — where a limited user lands instead of "/". */
export function firstAllowedTab(user: SessionUser): Tab | null {
    return TABS.find((t) => canAccess(user, t.area)) || null;
}

// Matches a tab's own path or one of its sub-routes (e.g. "/raids/new" under "/raids").
function matchesTab(tabHref: string, pathname: string): boolean {
    return pathname === tabHref || (tabHref !== "/" && pathname.startsWith(`${tabHref}/`));
}

function crumbTab(pathname: string) {
    return TABS.find((t) => matchesTab(t.href, pathname));
}

// Optional third breadcrumb segment for a page nested one level under its tab
// (e.g. the raid-create form under "Raid-Events", or the post-edit form under
// "Recruitment" — mirrors the equivalent crumb in src/web/renderAdmin.js).
function subCrumb(pathname: string, search: URLSearchParams): string | null {
    if (pathname === "/raids/new") return "Neues Event";
    if (pathname === "/raids/templates") return "Aufruf-Vorlagen";
    if (pathname === "/history/event") return "Event-Loot";
    if (pathname === "/history/char" || pathname === "/roster/char") return search.get("name") || "Charakter";
    if (pathname === "/recruitment" && (search.get("view") || "posts") === "posts" && search.get("editpost")) {
        return "Nachricht bearbeiten";
    }
    return null;
}

function AdminNav({ user }: { user: SessionUser }) {
    let lastGroup: string | null = null;
    return (
        <nav className="menu">
            {TABS.filter((tab) => canAccess(user, tab.area)).map((tab) => {
                const label = tab.group !== lastGroup ? tab.group : null;
                lastGroup = tab.group;
                return (
                    <div key={tab.id}>
                        {label && <div className="menu-label">{label}</div>}
                        <NavLink to={tab.href} end={tab.href === "/"} className={({ isActive }) => `nav-item area-${tab.id}${isActive ? " active" : ""}`}>
                            {tab.icon}
                            <span>{tab.label}</span>
                        </NavLink>
                    </div>
                );
            })}
        </nav>
    );
}

export default function Shell({ user, csrfToken, guilds, activeGuildId }: ShellContext & {
    guilds: SessionGuild[];
    activeGuildId: string;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    const initial = (user.name || "Admin").slice(0, 1).toUpperCase() || "A";

    const tab = crumbTab(location.pathname);
    const label = tab ? tab.label : "Übersicht";
    const crumb = subCrumb(location.pathname, new URLSearchParams(location.search));

    return (
        <div className="app">
            <aside className={`side${menuOpen ? " open" : ""}`}>
                <div className="brand">
                    <div className="crest"><CrestIcon /></div>
                    <div>
                        <div className="brand-name">EventHelper</div>
                        <div className="brand-sub">Gilden-Admin</div>
                    </div>
                </div>
                <AdminNav user={user} />
                <div className="side-foot">
                    <div className="avatar">{initial}</div>
                    <div className="ub-meta">
                        <div className="u-name">{user.name}</div>
                        <div className="u-role">{user.isAdmin ? "Administrator" : "Eingeschränkter Zugang"}</div>
                    </div>
                    <a className="u-logout" href="/auth/logout">Logout</a>
                </div>
            </aside>
            <div className="main">
                <header className="topbar">
                    <button className="menu-toggle" type="button" aria-label="Menü" onClick={() => setMenuOpen((o) => !o)}>
                        <BurgerIcon />
                    </button>
                    <div className="crumbs">
                        <Link to="/">Admin</Link> <span style={{ opacity: .45 }}>/</span>{" "}
                        {crumb && tab ? <Link to={tab.href}>{label}</Link> : <b>{label}</b>}
                        {crumb && <> <span style={{ opacity: .45 }}>/</span> <b>{crumb}</b></>}
                    </div>
                    <div className="top-actions">
                        <GuildSwitcher guilds={guilds} activeGuildId={activeGuildId} csrfToken={csrfToken} />
                        <ThemeToggle />
                    </div>
                </header>
                <div className="content">
                    <Outlet context={{ user, csrfToken } satisfies ShellContext} />
                </div>
            </div>
        </div>
    );
}
