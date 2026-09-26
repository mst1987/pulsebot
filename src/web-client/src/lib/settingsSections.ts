// The layout of the Einstellungen page: one section per topic, grouped by *who
// owns the setting* rather than by which feature happens to read it.
//
//   Zugang          — who gets in at all (the admin roles are one group of the matrix)
//   Verbindungen    — every external system the bot talks to, as status cards
//   Raid-Kategorien — everything that is configured per raid category
//   Module          — the behaviour of one single feature
//
// Fifteen sections used to share this column, most of them with one or two
// fields, and none said whether something was missing there. Ten are left, each
// with a WoW icon, and the two that can be incomplete carry a count.

import { t } from "../i18n";

export type SettingsGroup = "access" | "connections" | "categories" | "modules";

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
    { id: "berechtigungen", group: "access", icon: "inv_scroll_11", adminOnly: true },

    { id: "verbindungen", group: "connections", icon: "inv_misc_horn_01", standalone: true },
    { id: "discordserver", group: "connections", icon: "inv_letter_15", adminOnly: true, standalone: true },

    { id: "kategorien", group: "categories", icon: "inv_banner_03" },

    { id: "raids", group: "modules", icon: "inv_misc_note_02" },
    { id: "raidsheets", group: "modules", icon: "inv_scroll_03", standalone: true },
    { id: "topitems", group: "modules", icon: "inv_misc_bag_10" },
    { id: "logs", group: "modules", icon: "inv_misc_pocketwatch_01" },
    { id: "recruitment", group: "modules", icon: "inv_misc_grouplooking" },
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
