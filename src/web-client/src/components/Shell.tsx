import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
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
    { id: "recruitment", label: "Recruitment", href: "/admin/recruitment", group: "Verwaltung", icon: <RecruitmentIcon /> },
    { id: "cla", label: "CLA / Logcheck", href: "/admin/cla", group: "Verwaltung", icon: <ClaIcon /> },
    { id: "raids", label: "Raid-Events", href: "/admin/raids", group: "Verwaltung", icon: <RaidsIcon /> },
    { id: "history", label: "Historie & Loot", href: "/admin/history", group: "Verwaltung", icon: <HistoryIcon /> },
    { id: "channels", label: "Kanäle", href: "/channels", group: "Verwaltung", icon: <ChannelsIcon />, internal: true },
    { id: "settings", label: "Einstellungen", href: "/settings", group: "System", icon: <SettingsIcon />, internal: true },
];

function crumbLabel(pathname: string): string {
    const tab = TABS.find((t) => t.internal && t.href === pathname);
    return tab ? tab.label : "Übersicht";
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
                            <NavLink to={tab.href} end className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
                                {tab.icon}
                                <span>{tab.label}</span>
                            </NavLink>
                        ) : (
                            <a className="nav-item" href={tab.href}>
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
                    <div className="crumbs">Admin <span style={{ opacity: .45 }}>/</span> <b>{crumbLabel(location.pathname)}</b></div>
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
