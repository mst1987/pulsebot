// The admin menu as the client sees it. The list itself is src/config/menu.json,
// shared with the server-rendered chrome of the report pages
// (src/web/adminChrome.js via src/config/menu.js), so the two can no longer
// drift apart.
import MENU_JSON from "../../../config/menu.json";
import { canAccessAny, type SessionUser } from "../api";

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
     * a sub entry: one of the children the entry it belongs to (the one whose
     * href it lies under) folds out under its chevron in the shell's menu; the
     * parent then only "holds" the open page. Without that parent shown it is
     * an entry of its own.
     */
    sub?: boolean;
};

export const MENU: MenuEntry[] = MENU_JSON;

/**
 * The first entry the user may open — where a limited user lands instead of "/".
 * It lives here and not in Shell.tsx so that App.tsx can ask for it without
 * pulling the whole shell into the first chunk: the shell is loaded lazily
 * (App.tsx, #436).
 */
export function firstAllowedTab(user: SessionUser): MenuEntry | null {
    return MENU.find((t) => canAccessAny(user, t.areas)) || null;
}
