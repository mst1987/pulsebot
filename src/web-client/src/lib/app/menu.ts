// The admin menu as the client sees it. The list itself is src/config/menu.json,
// shared with the server-rendered chrome of the report pages
// (src/web/adminChrome.js via src/config/menu.js), so the two can no longer
// drift apart.
import MENU_JSON from "../../../../config/menu.json";
import { canAccessAny, type SessionUser } from "../../api";
import { tOr } from "../../i18n";

/**
 * One menu entry. `areas` are the permission areas from
 * src/config/permissions.js: the entry appears when the user's rights cover
 * *one* of them (the API enforces it for real, see src/web/apiAccess.js). Only
 * "Historie & Loot" has more than one — "loot" opens its loot views alone.
 */
export type MenuEntry = {
    id: string;
    label: string;
    href: string;
    group: string;
    areas: string[];
    wowIcon: string;
    /** the colour of another area (a sub entry of Raid-Events keeps the raids colour) */
    area?: string;
    /**
     * a sub entry: no line of its own in the main menu, but a page of the entry
     * whose href it lies under (Raidplan-Vorlagen under Raid-Events). Those
     * pages carry the whole family in their icon rail (components/ui/SectionRail.tsx),
     * and the parent's menu line stays active on all of them.
     */
    sub?: boolean;
    /**
     * full admins only, whatever areas an account holds (the system status,
     * docs/system-status.md): its API route is `adminOnly` too, and `areas` is empty.
     */
    adminOnly?: boolean;
    /**
     * a page without game content (Kanäle, Rollen-Nachrichten, Einstellungen, Systemstatus): it keeps
     * the brand colour whichever version the content switch shows (#742). The one
     * list of version-neutral pages.
     */
    neutral?: boolean;
    /**
     * where the menu line leads instead of `href` (Discord opens its overview
     * /channels/overview); the family still lies under `href`, and the page at
     * `landing` is a sub entry of its own (the first tab of the family).
     */
    landing?: string;
};

export const MENU: MenuEntry[] = MENU_JSON;

/**
 * Pages under a tab that follows the version but are version-neutral themselves:
 * an addon's detail page /addon/<id> shows that addon whatever version the menu
 * shows (its version is a badge), so it keeps the brand colour and drops the switch.
 */
const NEUTRAL_SUBPAGES = [/^\/addon\/[^/]+\/?$/];

/** Whether a page keeps the brand colour and shows no content switch: menu.json `neutral`, or one of the sub pages above. */
export function isNeutralPage(entry: MenuEntry | undefined, pathname: string): boolean {
    return !!(entry && entry.neutral) || NEUTRAL_SUBPAGES.some((re) => re.test(pathname));
}

/** Whether the account may open an entry: one of its areas, or full admin for an adminOnly entry. */
export function mayOpen(user: SessionUser | null, entry: MenuEntry): boolean {
    if (entry.adminOnly) return !!(user && user.isAdmin);
    return canAccessAny(user, entry.areas);
}

/** A menu entry's label in the active language (menu.json holds the German one). */
export function menuLabel(entry: MenuEntry): string {
    return tOr(`shell.menu.${entry.id}`, entry.label);
}

/** Matches an entry's own path or one of its sub-routes (e.g. "/raids/new" under "/raids"). */
export function matchesHref(href: string, pathname: string): boolean {
    return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

/** The top-level entry a sub entry belongs to: the one whose href it lies under. */
export function parentEntry(entry: MenuEntry): MenuEntry | undefined {
    if (!entry.sub) return undefined;
    return MENU.find((o) => !o.sub && o.href !== "/" && entry.href.startsWith(`${o.href}/`));
}

/** A top-level entry and its sub entries, in menu order: the pages of its rail. */
export function menuFamily(id: string): MenuEntry[] {
    return MENU.filter((e) => (e.id === id && !e.sub) || parentEntry(e)?.id === id);
}

/** One line of the main menu: the entry it shows, where it leads, and every page it stays active on. */
export type MenuLine = { top: MenuEntry; entry: MenuEntry; href: string; hrefs: string[] };

/**
 * The main menu of an account: one line per top-level entry whose family it
 * may open. The line shows that entry, or — when the account may only open its
 * sub pages (the raid plan without the raid events) — the first of those, so
 * the family stays reachable; the page's rail then offers the rest.
 */
export function menuLines(user: SessionUser): MenuLine[] {
    return MENU.filter((e) => !e.sub).flatMap((top) => {
        const allowed = menuFamily(top.id).filter((e) => mayOpen(user, e));
        if (!allowed.length) return [];
        const entry = allowed[0];
        // the top entry's landing page, when the account may open it (same family, so normally always)
        const landing = entry === top && top.landing && allowed.some((e) => e.href === top.landing) ? top.landing : "";
        return [{ top, entry, href: landing || entry.href, hrefs: allowed.map((e) => e.href) }];
    });
}

/**
 * The first entry the user may open — where a limited user lands instead of "/".
 * It lives here and not in Shell.tsx so that App.tsx can ask for it without
 * pulling the whole shell into the first chunk: the shell is loaded lazily
 * (App.tsx, #436).
 */
export function firstAllowedTab(user: SessionUser): MenuEntry | null {
    return MENU.find((t) => mayOpen(user, t)) || null;
}

/**
 * Where opening an entry leads: its landing page (System › Discord → the
 * Übersicht) when the account may open that page, else its own href.
 */
export function entryHref(user: SessionUser, entry: MenuEntry): string {
    const landing = entry.landing ? MENU.find((e) => e.href === entry.landing) : undefined;
    return landing && mayOpen(user, landing) ? landing.href : entry.href;
}
