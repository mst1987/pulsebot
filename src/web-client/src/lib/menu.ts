// The admin menu as the client sees it. The list itself is src/config/menu.json,
// shared with the server-rendered chrome of the report pages
// (src/web/adminChrome.js via src/config/menu.js), so the two can no longer
// drift apart.
import MENU_JSON from "../../../config/menu.json";

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
};

export const MENU: MenuEntry[] = MENU_JSON;
