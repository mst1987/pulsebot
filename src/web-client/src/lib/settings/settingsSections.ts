// The layout of the Einstellungen page: one section per topic, in the same two
// blocks as the menu (#918, Epic #926 "Daten je Server"):
//
//   Server       — what belongs to the active Discord server: who gets in, its
//                  raid categories, raid defaults, logs, recruitment, raid
//                  sheets, top items
//   Alle Server  — what the whole bot shares: the server list and its links,
//                  the external connections, game versions, dungeons, addons
//
// Each section carries an icon of the app's set (#951), and the two that can be incomplete a count.

import { t } from "../../i18n";

export type SettingsGroup = "server" | "global";

export type SettingsSection = {
    /** Also the key of its texts: settings.sections.<id>.label / .crumb. */
    id: string;
    group: SettingsGroup;
    /**
     * Icon of the sidebar entry and the part head: a key of the app's set (#951,
     * lib/ui/iconSet.ts). The version sections take a glyph too: Classic and
     * TBC share one launcher icon, and that icon never stands without its label.
     */
    icon: string;
    /**
     * Full admins only. Mirrors what the API enforces (ACCESS_KEYS with
     * requireFullAdmin in src/web/apiRoutes/settings.js).
     */
    adminOnly?: boolean;
    /**
     * The section saves itself (its modals, its own editor) instead of taking
     * part in the page's shared draft — so the save bar does not count it.
     */
    standalone?: boolean;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
    // the active server's block
    { id: "berechtigungen", group: "server", icon: "permissions", adminOnly: true },
    { id: "kategorien", group: "server", icon: "categories" },
    // #957 review: which version each of this server's categories plays (and the switch
    // dialog, #738) - settings writers change it, so it never moved to "Alle Server"
    { id: "kategorieversion", group: "server", icon: "catalog" },
    { id: "raids", group: "server", icon: "raids" },
    { id: "logs", group: "server", icon: "warcraftLogs" },
    { id: "recruitment", group: "server", icon: "recruitment" },
    // #923: this server's own armory/log links and realm per version, saved on its own
    { id: "versionlinks", group: "server", icon: "links", standalone: true },
    { id: "raidsheets", group: "server", icon: "googleSheets", standalone: true },
    // #927: Raid-Helper per server - switch, id, key, the sync and the retirement; full admins only
    { id: "raidhelper", group: "server", icon: "raidHelper", adminOnly: true, standalone: true },
    // #957: stays with the server - #952 turns it into a setting per server and version
    { id: "topitems", group: "server", icon: "loot", standalone: true },

    // the block "Alle Server"
    { id: "discordserver", group: "global", icon: "discordServer", adminOnly: true, standalone: true },
    // #925: the one access setting every server shares - the rest is per server (berechtigungen)
    { id: "vollAdmins", group: "global", icon: "fullAdmin", adminOnly: true },
    { id: "verbindungen", group: "global", icon: "apiToken", standalone: true },
    // #541: the main game version, hiding the others, version links, features and the launch -
    // the categories that play another one are the server's (kategorieversion)
    { id: "spielversion", group: "global", icon: "catalog" },
    { id: "dungeons", group: "global", icon: "bestTimes" },
    // #818: the addons of the page "Addons" - saved on its own, full admins only (ADDON_KEYS)
    { id: "addons", group: "global", icon: "addons", adminOnly: true, standalone: true },
];

/** Sidebar entry and the part head's title, in the active language. */
export function sectionLabel(section: SettingsSection): string {
    return t(`settings.sections.${section.id}.label`);
}

/** Breadcrumb under the part head's title. */
export function sectionCrumb(section: SettingsSection): string {
    return t(`settings.sections.${section.id}.crumb`);
}

/** The heading of a sidebar group. */
export function groupLabel(group: SettingsGroup): string {
    return t(`settings.groups.${group}`);
}

/**
 * Ids of the sections that were merged away, and where they went. A link such
 * as `?section=raidchars` or a section remembered from an older build must land
 * on the section that holds the setting now, not on the first one.
 */
export const LEGACY_SECTIONS: Record<string, string> = {
    zugang: "berechtigungen",
    discord: "verbindungen",
    battlenet: "verbindungen",
    anthropic: "verbindungen",
    warcraftlogs: "verbindungen",
    lootsync: "verbindungen",
    raidchars: "kategorien",
    loot: "topitems",
};

/** Every id the url may carry: the current ones plus the redirected old ones. */
export const SECTION_PARAM_IDS: string[] = [...SETTINGS_SECTIONS.map((s) => s.id), ...Object.keys(LEGACY_SECTIONS)];

/** The sections this user may open — everything, unless they only hold write on "Einstellungen". */
export function visibleSections(canManageAccess: boolean): SettingsSection[] {
    return canManageAccess ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter((s) => !s.adminOnly);
}

/**
 * Which page a section lives on (#957): the active server's sections under
 * System › Einstellungen (/settings), the shared ones under Alle Server ›
 * Einstellungen (/settings/all, full admins only).
 */
export type SettingsScope = "server" | "all";

export const SCOPE_GROUP: Record<SettingsScope, SettingsGroup> = { server: "server", all: "global" };

export const SCOPE_PATH: Record<SettingsScope, string> = { server: "/settings", all: "/settings/all" };

/** The sections of one page that this user may open. */
export function sectionsFor(scope: SettingsScope, canManageAccess: boolean): SettingsSection[] {
    return visibleSections(canManageAccess).filter((s) => s.group === SCOPE_GROUP[scope]);
}

/** The ids one page's url may carry: its own sections plus the old ids that lead to one of them. */
export function sectionParamIds(scope: SettingsScope): string[] {
    const own = new Set(SETTINGS_SECTIONS.filter((s) => s.group === SCOPE_GROUP[scope]).map((s) => s.id));
    return [...own, ...Object.keys(LEGACY_SECTIONS).filter((old) => own.has(LEGACY_SECTIONS[old]))];
}

/**
 * The other page a `?section=` belongs to, when it is not this one's: an old
 * link /settings?section=discordserver leads to /settings/all?section=discordserver
 * (legacy ids followed first). Null when the id is this page's or unknown.
 */
export function sectionElsewhere(param: string | null, scope: SettingsScope): SettingsScope | null {
    if (!param) return null;
    const id = LEGACY_SECTIONS[param] || param;
    const section = SETTINGS_SECTIONS.find((s) => s.id === id);
    if (!section || section.group === SCOPE_GROUP[scope]) return null;
    return scope === "server" ? "all" : "server";
}

/**
 * The section to open: the remembered one (after following a legacy id) as long
 * as this user may see it, otherwise the first one available.
 */
export function resolveSection(stored: string, sections: SettingsSection[]): string {
    const id = LEGACY_SECTIONS[stored] || stored;
    return sections.some((s) => s.id === id) ? id : sections[0].id;
}

/** The sections in sidebar order, bundled under their group heading. */
export function groupedSections(sections: SettingsSection[]): { group: SettingsGroup; items: SettingsSection[] }[] {
    const out: { group: SettingsGroup; items: SettingsSection[] }[] = [];
    for (const section of sections) {
        const last = out[out.length - 1];
        if (last && last.group === section.group) last.items.push(section);
        else out.push({ group: section.group, items: [section] });
    }
    return out;
}

/** Whether the section's fields belong to the page's shared draft and save bar. */
export function savesWithForm(sectionId: string): boolean {
    const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId);
    return !!section && !section.standalone;
}
