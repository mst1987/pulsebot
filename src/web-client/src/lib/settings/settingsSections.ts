// The layout of the Einstellungen page: one section per topic, in the same two
// blocks as the menu (#918, Epic #926 "Daten je Server"):
//
//   Server       — what belongs to the active Discord server: who gets in, its
//                  raid categories, raid defaults, logs, recruitment, raid sheets
//   Alle Server  — what the whole bot shares: the server list and its links,
//                  the external connections, game versions, top items,
//                  dungeons, addons
//
// Each section carries a WoW icon, and the two that can be incomplete a count.

import { t } from "../../i18n";

export type SettingsGroup = "server" | "global";

export type SettingsSection = {
    /** Also the key of its texts: settings.sections.<id>.label / .crumb. */
    id: string;
    group: SettingsGroup;
    /** WoW icon of the sidebar entry and the part head. */
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
    { id: "berechtigungen", group: "server", icon: "inv_scroll_11", adminOnly: true },
    { id: "kategorien", group: "server", icon: "inv_banner_03" },
    { id: "raids", group: "server", icon: "inv_misc_note_02" },
    { id: "logs", group: "server", icon: "inv_misc_pocketwatch_01" },
    { id: "recruitment", group: "server", icon: "inv_misc_grouplooking" },
    { id: "raidsheets", group: "server", icon: "inv_scroll_03", standalone: true },
    // #927: Raid-Helper per server - switch, id, key, the sync and the retirement; full admins only
    { id: "raidhelper", group: "server", icon: "inv_misc_note_06", adminOnly: true, standalone: true },

    // the block "Alle Server"
    { id: "discordserver", group: "global", icon: "inv_letter_15", adminOnly: true, standalone: true },
    // #925: the one access setting every server shares - the rest is per server (berechtigungen)
    { id: "vollAdmins", group: "global", icon: "spell_holy_sealofwisdom", adminOnly: true },
    { id: "verbindungen", group: "global", icon: "inv_misc_horn_01", standalone: true },
    // #541: the main game version and the categories that play another one
    { id: "spielversion", group: "global", icon: "inv_misc_book_09" },
    { id: "topitems", group: "global", icon: "inv_misc_bag_10" },
    { id: "dungeons", group: "global", icon: "spell_holy_borrowedtime" },
    // #818: the addons of the page "Addons" - saved on its own, full admins only (ADDON_KEYS)
    { id: "addons", group: "global", icon: "inv_gizmo_01", adminOnly: true, standalone: true },
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
