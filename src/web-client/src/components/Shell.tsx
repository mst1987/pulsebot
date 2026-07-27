import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import {
    CrestIcon, BurgerIcon, HomeIcon, RecruitmentIcon, ClaIcon, RaidsIcon, ChannelsIcon, SettingsIcon, HistoryIcon,
} from "./icons";
import type { SessionUser } from "../api";

export type ShellContext = { user: SessionUser; csrfToken: string | null };

// Same tab list/grouping as src/web/renderAdmin.js's TABS — migrated pages use an
// internal <NavLink>, the rest still point back at the classic SSR pages (plain
// <a>, a full page navigation out of the SPA).
const TABS: { id: string; label: string; href: string; group: string; icon: ReactNode; internal?: boolean }[] = [
    { id: "home", label: "Übersicht", href: "/", group: "Verwaltung", icon: <HomeIcon />, internal: true },
    { id: "recruitment", label: "Recruitment", href: "/recruitment", group: "Verwaltung", icon: <RecruitmentIcon />, internal: true },
    { id: "cla", label: "CLA / Logcheck", href: "/cla", group: "Verwaltung", icon: <ClaIcon />, internal: true },
    { id: "raids", label: "Raid-Events", href: "/raids", group: "Verwaltung", icon: <RaidsIcon />, internal: true },
    { id: "history", label: "Historie & Loot", href: "/history", group: "Verwaltung", icon: <HistoryIcon />, internal: true },
    { id: "channels", label: "Kanäle", href: "/channels", group: "Verwaltung", icon: <ChannelsIcon />, internal: true },
    { id: "settings", label: "Einstellungen", href: "/settings", group: "System", icon: <SettingsIcon />, internal: true },
];

// Matches a tab's own path or one of its sub-routes (e.g. "/raids/new" under "/raids").
function matchesTab(tabHref: string, pathname: string): boolean {
    return pathname === tabHref || (tabHref !== "/" && pathname.startsWith(`${tabHref}/`));
}

function crumbTab(pathname: string) {
    return TABS.find((t) => t.internal && matchesTab(t.href, pathname));
}

// Optional third breadcrumb segment for a page nested one level under its tab
// (e.g. the raid-create form under "Raid-Events", or the post-edit form under
// "Recruitment" — mirrors the equivalent crumb in src/web/renderAdmin.js).
function subCrumb(pathname: string, search: URLSearchParams): string | null {
    if (pathname === "/raids/new") return "Neues Event";
    if (pathname === "/raids/templates") return "Aufruf-Vorlagen";
    if (pathname === "/history/event") return "Event-Loot";
    if (pathname === "/recruitment" && (search.get("view") || "posts") === "posts" && search.get("editpost")) {
        return "Nachricht bearbeiten";
    }
    return null;
}

function AdminNav() {
    let lastGroup: string | null = null;
    return (
        <nav className="menu">
            {TABS.map((tab) => {
                const label = tab.group !== lastGroup ? tab.group : null;
                lastGroup = tab.group;
                return (
                    <div key={tab.id}>
                        {label && <div className="menu-label">{label}</div>}
                        {tab.internal ? (
                            <NavLink to={tab.href} end={tab.href === "/"} className={({ isActive }) => `nav-item area-${tab.id}${isActive ? " active" : ""}`}>
                                {tab.icon}
                                <span>{tab.label}</span>
                            </NavLink>
                        ) : (
                            <a className={`nav-item area-${tab.id}`} href={tab.href}>
                                {tab.icon}
                                <span>{tab.label}</span>
                            </a>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}

export default function Shell({ user, csrfToken }: ShellContext) {
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
                <AdminNav />
                <div className="side-foot">
                    <div className="avatar">{initial}</div>
                    <div className="ub-meta">
                        <div className="u-name">{user.name}</div>
                        <div className="u-role">Administrator</div>
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
