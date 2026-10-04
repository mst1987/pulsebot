// The admin menu as the client sees it. The list itself is src/config/menu.json,
// shared with the server-rendered chrome of the report pages
// (src/web/adminChrome.js via src/config/menu.js), so the two can no longer
// drift apart.
import MENU_JSON from "../../../config/menu.json";
import { canAccessAny, type SessionUser } from "../api";
import { tOr } from "../i18n";

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
     * pages carry the whole family in their icon rail (components/SectionRail.tsx),
     * and the parent's menu line stays active on all of them.
     */
    sub?: boolean;
};

export const MENU: MenuEntry[] = MENU_JSON;

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

/** One line of the main menu: the entry it shows and every page it stays active on. */
export type MenuLine = { top: MenuEntry; entry: MenuEntry; hrefs: string[] };

/**
 * The main menu of an account: one line per top-level entry whose family it
 * may open. The line shows that entry, or — when the account may only open its
 * sub pages (the raid plan without the raid events) — the first of those, so
 * the family stays reachable; the page's rail then offers the rest.
 */
export function menuLines(user: SessionUser): MenuLine[] {
    return MENU.filter((e) => !e.sub).flatMap((top) => {
        const allowed = menuFamily(top.id).filter((e) => canAccessAny(user, e.areas));
        return allowed.length ? [{ top, entry: allowed[0], hrefs: allowed.map((e) => e.href) }] : [];
    });
}

/**
 * The first entry the user may open — where a limited user lands instead of "/".
 * It lives here and not in Shell.tsx so that App.tsx can ask for it without
 * pulling the whole shell into the first chunk: the shell is loaded lazily
 * (App.tsx, #436).
 */
export function firstAllowedTab(user: SessionUser): MenuEntry | null {
    return MENU.find((t) => canAccessAny(user, t.areas)) || null;
}
