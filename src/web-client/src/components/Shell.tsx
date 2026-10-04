import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import LangToggle from "./LangToggle";
import GuildSwitcher from "./GuildSwitcher";
import ContentSwitch from "./ContentSwitch";
import ContentVersionProvider from "./ContentVersionProvider";
import { ViewAsBanner, ViewAsButton } from "./ViewAs";
import { CrestIcon, BurgerIcon, LogoutIcon, BookIcon, ChevronDownIcon } from "./icons";
import WowIcon from "./ui/WowIcon";
import Badge from "./ui/Badge";
import type { NavBadge } from "./SectionNav";
import RaidLoader from "./ui/RaidLoader";
import ChunkErrorBoundary from "./ChunkErrorBoundary";
import { IconButton } from "./ui/Button";
import { TipLayer } from "./ui/Tip";
import { MENU, firstAllowedTab, type MenuEntry } from "../lib/menu";
import { canAccess, canAccessAny, getVersion, type SessionUser, type SessionGuild, type ContentInfo } from "../api";
import { useApi } from "../hooks/useApi";
import { deployLine } from "../lib/deployVersion";
import { usePersistedState } from "../lib/persistedState";
import { groupLabel, resolveSection, sectionLabel, visibleSections } from "../lib/settingsSections";
import { loadSettingsNav, sectionBadge, useSettingsNav } from "../lib/settingsNav";
import { t as tr, tOr, useLang, useT } from "../i18n";

export type ShellContext = { user: SessionUser };

// The menu entries come from src/config/menu.json, the one list the SSR chrome
// of the report pages (src/web/adminChrome.js) renders too. `areas` are the
// permission areas from src/config/permissions.js: a tab appears when the
// user's rights cover *one* of them (the API enforces it for real, see
// src/web/apiAccess.js).
type Tab = MenuEntry;
export const TABS: Tab[] = MENU;


// Matches a tab's own path or one of its sub-routes (e.g. "/raids/new" under "/raids").
function matchesTab(tabHref: string, pathname: string): boolean {
    return pathname === tabHref || (tabHref !== "/" && pathname.startsWith(`${tabHref}/`));
}

/** A menu entry's label in the active language (menu.json holds the German one). */
function tabLabel(tab: Tab): string {
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
    if (pathname === "/raids/plan-templates") return tr("shell.crumb.planTemplates");
    if (pathname === "/raids/plan-catalog") return tr("shell.crumb.planCatalog");
    if (pathname === "/history/event") return tr("shell.crumb.eventLoot");
    if (pathname === "/history/char" || pathname === "/roster/char") return search.get("name") || tr("shell.crumb.character");
    if (pathname === "/recruitment" && (search.get("view") || "posts") === "posts" && search.get("editpost")) {
        return tr("shell.crumb.editPost");
    }
    return null;
}

/** The folded-out state per entry id; an entry left out opens while its page is the current one. */
type OpenGroups = Record<string, boolean>;

/** One child of a menu entry: a sub page (Raidplan-Vorlagen) or a settings section. */
type NavKid = {
    id: string;
    href: string;
    label: string;
    icon: string;
    active: boolean;
    /** The small heading above it (the settings section groups), printed once per run. */
    group?: string;
    badge?: NavBadge | null;
};

/**
 * The children an entry folds out in the menu: the sub entries of menu.json
 * under it (Raid-Events → Raidplan-Vorlagen, Raidplan-Katalog), and for
 * "Einstellungen" the sections of the settings page — the same list, groups,
 * icons and badges the page's own column used to show (lib/settingsNav.ts).
 */
function useNavKids(user: SessionUser, allowed: Tab[]) {
    const { pathname, search } = useLocation();
    const settingsNav = useSettingsNav();
    // a sub entry folds under its parent only while that is shown too (Raidplan-Vorlagen without Raid-Events: its own area)
    const parentOf = (tab: Tab) => (tab.sub ? allowed.find((o) => !o.sub && o.href !== "/" && tab.href.startsWith(`${o.href}/`)) : undefined);
    const onSettings = pathname === "/settings";
    const sections = visibleSections(user.isAdmin);
    // the page knows the open section (remembered, legacy id); until it said so, the link's own
    const param = new URLSearchParams(search).get("section");
    const activeSection = onSettings ? (settingsNav.active || (param ? resolveSection(param, sections) : null)) : null;
    const kidsOf = (tab: Tab): NavKid[] => {
        if (tab.id === "settings") {
            return sections.map((s) => ({
                id: s.id,
                href: `/settings?section=${s.id}`,
                label: sectionLabel(s),
                icon: s.icon,
                active: activeSection === s.id,
                group: groupLabel(s.group),
                badge: sectionBadge(s.id, settingsNav.counts),
            }));
        }
        return allowed.filter((o) => parentOf(o)?.id === tab.id).map((o) => ({
            id: o.id, href: o.href, label: tabLabel(o), icon: o.wowIcon, active: matchesTab(o.href, pathname),
        }));
    };
    return { top: allowed.filter((tab) => !parentOf(tab)), kidsOf, onSettings, hasCounts: !!settingsNav.counts };
}

/**
 * Scrolls the menu just enough to show `el`: its bottom edge first, but never
 * so far that its top (the group's own entry) leaves the menu.
 */
function revealInMenu(menu: HTMLElement, el: HTMLElement) {
    const box = menu.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom > box.bottom) menu.scrollTop += Math.min(r.bottom - box.bottom + 8, r.top - box.top - 8);
    else if (r.top < box.top) menu.scrollTop -= box.top - r.top + 8;
}

function AdminNav({ user, onNavigate }: { user: SessionUser; onNavigate: () => void }) {
    const t = useT();
    let lastGroup: string | null = null;
    const { pathname } = useLocation();
    const allowed = TABS.filter((tab) => canAccessAny(user, tab.areas));
    const { top, kidsOf, onSettings, hasCounts } = useNavKids(user, allowed);
    // Which groups are folded out, per browser: absent = automatic (open while
    // its page is the current one), true/false = what the chevron last chose.
    const [groups, setGroups] = usePersistedState<OpenGroups>("menu-groups", {});
    const current = top.find((tab) => matchesTab(tab.href, pathname) && kidsOf(tab).length > 0)?.id || null;
    const isOpen = (tab: Tab) => groups[tab.id] ?? tab.id === current;
    const forget = (id: string) => setGroups((g) => {
        if (!(id in g)) return g;
        const next = { ...g };
        delete next[id];
        return next;
    });
    // Entering a group's page opens it again, even if it was folded away before.
    useEffect(() => {
        if (current) forget(current);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only on entering another group
    }, [current]);
    // The section badges outside the settings page: loaded once when the
    // Einstellungen group is folded out before the page published them.
    const settingsTab = top.find((tab) => tab.id === "settings");
    const needCounts = !!settingsTab && isOpen(settingsTab) && !onSettings && !hasCounts;
    useEffect(() => {
        if (needCounts) void loadSettingsNav(user.isAdmin);
    }, [needCounts, user.isAdmin]);
    // Einstellungen sits at the foot of the menu, so its sections fold out below
    // the fold of a laptop screen: the menu scrolls to the active child, and to
    // a group the chevron just opened.
    const navRef = useRef<HTMLElement>(null);
    const revealRef = useRef<string | null>(null);
    const activeKid = top.flatMap((tab) => kidsOf(tab)).find((k) => k.active)?.href || null;
    useEffect(() => {
        const navEl = navRef.current;
        if (!navEl) return;
        const opened = revealRef.current;
        revealRef.current = null;
        const target = opened
            ? document.getElementById(`nav-kids-${opened}`)?.closest<HTMLElement>(".nav-node")
            : navEl.querySelector<HTMLElement>(".nav-kid.active");
        if (target) revealInMenu(navEl, target);
    }, [activeKid, groups]);
    // The menu gets shorter once the deploy line below it has loaded (or the
    // window changes): the active child is shown again then.
    useEffect(() => {
        const navEl = navRef.current;
        if (!navEl || typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(() => {
            const kid = navEl.querySelector<HTMLElement>(".nav-kid.active");
            if (kid) revealInMenu(navEl, kid);
        });
        observer.observe(navEl);
        return () => observer.disconnect();
    }, []);
    // The sidebar is always rendered, so it has to say something when a member's
    // account opens nothing at all — an empty column reads like a broken page.
    if (!allowed.length) {
        return (
            <nav className="menu">
                <div className="menu-label">{t("shell.noArea.label")}</div>
                <p className="hint menu-hint">
                    {t("shell.noArea.text")}
                </p>
            </nav>
        );
    }
    return (
        <nav className="menu" ref={navRef}>
            {top.map((tab) => {
                const label = tab.group !== lastGroup ? tab.group : null;
                lastGroup = tab.group;
                const area = `area-${tab.area || tab.id}`;
                const kids = kidsOf(tab);
                const open = kids.length > 0 && isOpen(tab);
                // The entry holds the open page in one of its children: marked,
                // but not filled like the active entry itself. On the settings
                // page that is always so — a section is always open there.
                const holdsActive = kids.some((k) => k.active) || (tab.id === "settings" && onSettings);
                const name = tabLabel(tab);
                const kidsId = `nav-kids-${tab.id}`;
                const link = (
                    <NavLink
                        to={tab.href}
                        end={tab.href === "/"}
                        // Clicking the entry goes to its page as always; the
                        // group then opens because it is the current one.
                        onClick={() => { forget(tab.id); onNavigate(); }}
                        // the child is the page then, for a screen reader too
                        aria-current={holdsActive ? "false" : "page"}
                        className={({ isActive }) => `nav-item ${area}${holdsActive ? " has-active" : isActive ? " active" : ""}`}
                    >
                        <WowIcon name={tab.wowIcon} size={24} />
                        <span>{name}</span>
                    </NavLink>
                );
                let lastKidGroup: string | undefined;
                return (
                    <div key={tab.id}>
                        {label && <div className="menu-label">{tOr(`shell.group.${label}`, label)}</div>}
                        {kids.length === 0 ? link : (
                            <div className={`nav-node${open ? " open" : ""}`}>
                                <div className="nav-row">
                                    {link}
                                    <button
                                        type="button"
                                        className="nav-chev"
                                        aria-expanded={open}
                                        aria-controls={kidsId}
                                        aria-label={t(open ? "shell.nav.collapse" : "shell.nav.expand", { name })}
                                        onClick={() => {
                                            revealRef.current = open ? null : tab.id;
                                            setGroups((g) => ({ ...g, [tab.id]: !open }));
                                        }}
                                    >
                                        <ChevronDownIcon />
                                    </button>
                                </div>
                                <div className={`nav-kids ${area}`} id={kidsId} hidden={!open}>
                                    {open && kids.map((kid) => {
                                        const kidGroup = kid.group !== lastKidGroup ? kid.group : undefined;
                                        lastKidGroup = kid.group;
                                        return (
                                            <Fragment key={kid.id}>
                                                {kidGroup && <div className="nav-kid-label">{kidGroup}</div>}
                                                <Link
                                                    to={kid.href}
                                                    onClick={onNavigate}
                                                    className={`nav-kid${kid.active ? " active" : ""}`}
                                                    aria-current={kid.active ? "page" : undefined}
                                                >
                                                    <WowIcon name={kid.icon} size={18} />
                                                    <span className="nav-kid-text">{kid.label}</span>
                                                    {kid.badge && kid.badge.count > 0 && (
                                                        <Badge count size="sm" tone={kid.badge.tone} tip={kid.badge.tip}>{kid.badge.count}</Badge>
                                                    )}
                                                </Link>
                                            </Fragment>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
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
    const maySee = canAccess(user, "settings");
    const version = useApi(() => getVersion(), [], { enabled: maySee }).data;
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

export default function Shell({ user, guilds, activeGuildId, content }: ShellContext & {
    guilds: SessionGuild[];
    activeGuildId: string;
    /** The content switch (#563); missing = no switch, the server picks the main version. */
    content?: ContentInfo | null;
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
        <ContentVersionProvider content={content}>
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
                            <ContentSwitch />
                            <GuildSwitcher guilds={guilds} activeGuildId={activeGuildId} />
                            <ViewAsButton user={user} />
                            {/* A real link, not a button: it leaves the SPA for the
                                server-rendered docs page (src/web/docsPage.js). */}
                            <a className="ibtn" href="/docs" aria-label={t("shell.docs")} data-tip={t("shell.docs")}>
                                <BookIcon />
                            </a>
                            <LangToggle account />
                            <ThemeToggle />
                        </div>
                    </header>
                    <div className="content" key={lang}>
                        {/* While an admin looks at the menu as a role: which one, and the way back. */}
                        <ViewAsBanner user={user} />
                        {/* Every page is its own chunk (App.tsx, #436): while one loads,
                            the menu stays and only the page body shows the loader. A chunk
                            that cannot be loaded (after a deploy, #530) shows the reload
                            notice there too, and the next page tries again. */}
                        <ChunkErrorBoundary resetKey={location.pathname}>
                            <Suspense fallback={<RaidLoader />}>
                                <Outlet context={{ user } satisfies ShellContext} />
                            </Suspense>
                        </ChunkErrorBoundary>
                    </div>
                </div>
                <TipLayer />
            </div>
        </ContentVersionProvider>
    );
}
