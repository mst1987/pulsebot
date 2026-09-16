import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import GuildSwitcher from "./GuildSwitcher";
import { CrestIcon, BurgerIcon, LogoutIcon } from "./icons";
import WowIcon from "./ui/WowIcon";
import { IconButton } from "./ui/Button";
import { TipLayer } from "./ui/Tip";
import { MENU, type MenuEntry } from "../lib/menu";
import { canAccessAny, type SessionUser, type SessionGuild } from "../api";

export type ShellContext = { user: SessionUser; csrfToken: string | null };

// The menu entries come from src/config/menu.json, the one list the SSR chrome
// of the report pages (src/web/adminChrome.js) renders too. `areas` are the
// permission areas from src/config/permissions.js: a tab appears when the
// user's rights cover *one* of them (the API enforces it for real, see
// src/web/apiAccess.js).
type Tab = MenuEntry;
export const TABS: Tab[] = MENU;

/** The first tab the user may open — where a limited user lands instead of "/". */
export function firstAllowedTab(user: SessionUser): Tab | null {
    return TABS.find((t) => canAccessAny(user, t.areas)) || null;
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
    if (pathname === "/raids/raid-templates") return "Raid-Vorlagen";
    if (pathname === "/history/event") return "Event-Loot";
    if (pathname === "/history/char" || pathname === "/roster/char") return search.get("name") || "Charakter";
    if (pathname === "/recruitment" && (search.get("view") || "posts") === "posts" && search.get("editpost")) {
        return "Nachricht bearbeiten";
    }
    return null;
}

function AdminNav({ user, onNavigate }: { user: SessionUser; onNavigate: () => void }) {
    let lastGroup: string | null = null;
    const allowed = TABS.filter((tab) => canAccessAny(user, tab.areas));
    // The sidebar is always rendered, so it has to say something when a member's
    // account opens nothing at all — an empty column reads like a broken page.
    if (!allowed.length) {
        return (
            <nav className="menu">
                <div className="menu-label">Kein Bereich freigegeben</div>
                <p className="hint" style={{ padding: "0 14px" }}>
                    Für dein Discord-Konto ist noch kein Bereich dieses Menüs freigeschaltet.
                </p>
            </nav>
        );
    }
    return (
        <nav className="menu">
            {allowed.map((tab) => {
                const label = tab.group !== lastGroup ? tab.group : null;
                lastGroup = tab.group;
                return (
                    <div key={tab.id}>
                        {label && <div className="menu-label">{label}</div>}
                        <NavLink
                            to={tab.href}
                            end={tab.href === "/"}
                            onClick={onNavigate}
                            className={({ isActive }) => `nav-item area-${tab.id}${isActive ? " active" : ""}`}
                        >
                            <WowIcon name={tab.wowIcon} size={24} />
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
                {/* The crest is the way home: "/" is the dashboard, or — for an
                    account without dashboard access — App.tsx's redirect to the
                    first section that account may open. The menu closes on the
                    click like a nav item, so on a phone the page shows. The
                    crest stays a line icon: it is the brand, not a game thing. */}
                <Link className="brand" to="/" aria-label="Zur Übersicht" onClick={() => setMenuOpen(false)}>
                    <div className="crest"><CrestIcon /></div>
                    <div>
                        <div className="brand-name">EventHelper</div>
                        {/* Not "Gilden-Admin": most people in here are members
                            looking up loot, not officers. */}
                        <div className="brand-sub">Gildenmenü</div>
                    </div>
                </Link>
                <AdminNav user={user} onNavigate={() => setMenuOpen(false)} />
                <div className="side-foot">
                    <div className="avatar">{initial}</div>
                    <div className="ub-meta">
                        <div className="u-name">{user.name}</div>
                        <div className="u-role">
                            {user.isAdmin ? "Administrator" : firstAllowedTab(user) ? "Eingeschränkter Zugang" : "Kein Zugang"}
                        </div>
                    </div>
                    {/* A real link, not a button: logging out is a navigation to
                        the server, and it has to work without any script state. */}
                    <a className="ibtn sm u-logout" href="/auth/logout" aria-label="Logout" data-tip="Logout" data-tip-sub="Vom Gildenmenü abmelden">
                        <LogoutIcon />
                    </a>
                </div>
            </aside>
            <div className="main">
                <header className="topbar">
                    <IconButton className="menu-toggle" icon={<BurgerIcon />} tip="Menü" onClick={() => setMenuOpen((o) => !o)} />
                    <div className="crumbs">
                        <Link to="/">Menü</Link> <span className="crumb-sep">/</span>{" "}
                        {crumb && tab ? <Link to={tab.href}>{label}</Link> : <b>{label}</b>}
                        {crumb && <> <span className="crumb-sep">/</span> <b>{crumb}</b></>}
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
            <TipLayer />
        </div>
    );
}
