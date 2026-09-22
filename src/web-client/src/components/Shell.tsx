import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import LangToggle from "./LangToggle";
import GuildSwitcher from "./GuildSwitcher";
import { ViewAsBanner, ViewAsButton } from "./ViewAs";
import { CrestIcon, BurgerIcon, LogoutIcon } from "./icons";
import WowIcon from "./ui/WowIcon";
import { IconButton } from "./ui/Button";
import { TipLayer } from "./ui/Tip";
import { MENU, type MenuEntry } from "../lib/menu";
import { canAccess, canAccessAny, getVersion, type SessionUser, type SessionGuild } from "../api";
import { deployLine, type DeployVersion } from "../lib/deployVersion";
import { t as tr, tOr, useLang, useT } from "../i18n";

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

/** A menu entry's label in the active language (menu.json holds the German one). */
export function tabLabel(tab: Tab): string {
    return tOr(`shell.menu.${tab.id}`, tab.label);
}

function crumbTab(pathname: string) {
    return TABS.find((t) => matchesTab(t.href, pathname));
}

// Optional third breadcrumb segment for a page nested one level under its tab
// (e.g. the raid-create form under "Raid-Events", or the post-edit form under
// "Recruitment" — mirrors the equivalent crumb in src/web/renderAdmin.js).
function subCrumb(pathname: string, search: URLSearchParams): string | null {
    if (pathname === "/raids/new") return tr("shell.crumb.newEvent");
    if (pathname === "/raids/templates") return tr("shell.crumb.notifyTemplates");
    if (pathname === "/raids/raid-templates") return tr("shell.crumb.raidTemplates");
    if (pathname === "/raids/series") return tr("shell.crumb.series");
    if (pathname === "/history/event") return tr("shell.crumb.eventLoot");
    if (pathname === "/history/char" || pathname === "/roster/char") return search.get("name") || tr("shell.crumb.character");
    if (pathname === "/recruitment" && (search.get("view") || "posts") === "posts" && search.get("editpost")) {
        return tr("shell.crumb.editPost");
    }
    return null;
}

function AdminNav({ user, onNavigate }: { user: SessionUser; onNavigate: () => void }) {
    const t = useT();
    let lastGroup: string | null = null;
    const allowed = TABS.filter((tab) => canAccessAny(user, tab.areas));
    // The sidebar is always rendered, so it has to say something when a member's
    // account opens nothing at all — an empty column reads like a broken page.
    if (!allowed.length) {
        return (
            <nav className="menu">
                <div className="menu-label">{t("shell.noArea.label")}</div>
                <p className="hint" style={{ padding: "0 14px" }}>
                    {t("shell.noArea.text")}
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
                        {label && <div className="menu-label">{tOr(`shell.group.${label}`, label)}</div>}
                        <NavLink
                            to={tab.href}
                            end={tab.href === "/"}
                            onClick={onNavigate}
                            className={({ isActive }) => `nav-item area-${tab.id}${isActive ? " active" : ""}`}
                        >
                            <WowIcon name={tab.wowIcon} size={24} />
                            <span>{tabLabel(tab)}</span>
                        </NavLink>
                    </div>
                );
            })}
        </nav>
    );
}

/**
 * "Server läuft auf a1b2c3d vom 12.09. · main ist 9 Commits weiter" (#314) —
 * one quiet line above the user block, everything else in its tooltip. Loaded
 * once per mount and only for settings readers: they are the ones who would act
 * on it, and it keeps a member's page load from triggering a GitHub lookup.
 * Any failure leaves the line out entirely rather than showing an error.
 */
function DeployLine({ user }: { user: SessionUser }) {
    const [version, setVersion] = useState<DeployVersion | null>(null);
    const maySee = canAccess(user, "settings");
    useEffect(() => {
        if (!maySee) return;
        let alive = true;
        getVersion().then((v) => { if (alive) setVersion(v); }).catch(() => {});
        return () => { alive = false; };
    }, [maySee]);
    if (!version) return null;
    const line = deployLine(version);
    if (!line.text) return null;
    return (
        <div className={`side-version v-${line.tone}`} data-tip={line.tip} data-tip-sub={line.tipSub}>
            <span className="v-dot" aria-hidden="true" />
            <span className="v-text">{line.text}</span>
        </div>
    );
}

export default function Shell({ user, csrfToken, guilds, activeGuildId }: ShellContext & {
    guilds: SessionGuild[];
    activeGuildId: string;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    const t = useT();
    // The page below remounts on a language switch, so labels a page computed
    // once (memoised tables, lib helpers) are drawn again in the new language.
    const lang = useLang();
    const initial = (user.name || "Admin").slice(0, 1).toUpperCase() || "A";

    const tab = crumbTab(location.pathname);
    const label = tab ? tabLabel(tab) : t("shell.menu.home");
    const crumb = subCrumb(location.pathname, new URLSearchParams(location.search));

    return (
        <div className="app">
            <aside className={`side${menuOpen ? " open" : ""}`}>
                {/* The crest is the way home: "/" is the dashboard, or — for an
                    account without dashboard access — App.tsx's redirect to the
                    first section that account may open. The menu closes on the
                    click like a nav item, so on a phone the page shows. The
                    crest stays a line icon: it is the brand, not a game thing. */}
                <Link className="brand" to="/" aria-label={t("shell.toHome")} onClick={() => setMenuOpen(false)}>
                    <div className="crest"><CrestIcon /></div>
                    <div>
                        <div className="brand-name">EventHelper</div>
                        {/* Not "Gilden-Admin": most people in here are members
                            looking up loot, not officers. */}
                        <div className="brand-sub">{t("shell.brandSub")}</div>
                    </div>
                </Link>
                <AdminNav user={user} onNavigate={() => setMenuOpen(false)} />
                <DeployLine user={user} />
                <div className="side-foot">
                    <div className="avatar">{initial}</div>
                    <div className="ub-meta">
                        <div className="u-name">{user.name}</div>
                        <div className="u-role">
                            {user.isAdmin ? t("shell.role.admin") : firstAllowedTab(user) ? t("shell.role.limited") : t("shell.role.none")}
                        </div>
                    </div>
                    {/* A real link, not a button: logging out is a navigation to
                        the server, and it has to work without any script state. */}
                    <a className="ibtn sm u-logout" href="/auth/logout" aria-label={t("shell.logout")} data-tip={t("shell.logout")} data-tip-sub={t("shell.logoutSub")}>
                        <LogoutIcon />
                    </a>
                </div>
            </aside>
            <div className="main">
                <header className="topbar">
                    <IconButton className="menu-toggle" icon={<BurgerIcon />} tip={t("shell.menuToggle")} onClick={() => setMenuOpen((o) => !o)} />
                    <div className="crumbs">
                        <Link to="/">{t("shell.crumb.menu")}</Link> <span className="crumb-sep">/</span>{" "}
                        {crumb && tab ? <Link to={tab.href}>{label}</Link> : <b>{label}</b>}
                        {crumb && <> <span className="crumb-sep">/</span> <b>{crumb}</b></>}
                    </div>
                    <div className="top-actions">
                        <GuildSwitcher guilds={guilds} activeGuildId={activeGuildId} csrfToken={csrfToken} />
                        <ViewAsButton user={user} csrfToken={csrfToken} />
                        <LangToggle csrfToken={csrfToken} />
                        <ThemeToggle />
                    </div>
                </header>
                <div className="content" key={lang}>
                    {/* While an admin looks at the menu as a role: which one, and the way back. */}
                    <ViewAsBanner user={user} csrfToken={csrfToken} />
                    <Outlet context={{ user, csrfToken } satisfies ShellContext} />
                </div>
            </div>
            <TipLayer />
        </div>
    );
}
