// The layout of the Einstellungen page: one section per topic, grouped by *who
// owns the setting* rather than by which feature happens to read it.
//
//   Zugang          — who gets in at all
//   Verbindungen    — the external systems the bot talks to, plus their credentials
//   Raid-Kategorien — everything that is configured per raid category
//   Module          — the behaviour of one single feature
//
// Battle.net used to sit inside an "Events" tab and the addon tokens in a
// top-level "Loot-Sync" one; both are connections to a foreign system and now
// live together, where they are actually looked for.

export type SettingsSection = {
    id: string;
    /** Sidebar entry and the panel's own heading. */
    label: string;
    group: string;
    /**
     * Full admins only. Mirrors what the API enforces (ACCESS_KEYS and
     * requireFullAdmin in src/web/apiRoutes/settings.js) — plus the Discord and
     * Raid-Helper server ids, which decide which guild the admin-role check runs
     * against and have been admin-only ever since they shared the "Zugang" tab.
     */
    adminOnly?: boolean;
    /**
     * The section saves itself instead of taking part in the page's one big
     * config form — so the shared "Speichern" button must not appear under it.
     */
    standalone?: boolean;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
    { id: "zugang", group: "Zugang", label: "Admin-Zugang", adminOnly: true },
    { id: "berechtigungen", group: "Zugang", label: "Rollen-Berechtigungen", adminOnly: true },

    { id: "discord", group: "Verbindungen", label: "Discord & Raid-Helper", adminOnly: true },
    { id: "battlenet", group: "Verbindungen", label: "Battle.net / Armory" },
    { id: "lootsync", group: "Verbindungen", label: "Loot-Sync (Addon)", adminOnly: true, standalone: true },

    { id: "kategorien", group: "Raid-Kategorien", label: "Kategorien" },
    { id: "raidchars", group: "Raid-Kategorien", label: "Raider → Charakter", standalone: true },

    { id: "raids", group: "Module", label: "Raid-Standardwerte" },
    { id: "raidsheets", group: "Module", label: "Raidsheets", standalone: true },
    { id: "loot", group: "Module", label: "Loot" },
    { id: "logs", group: "Module", label: "Log-Auswertung" },
    { id: "recruitment", group: "Module", label: "Recruitment" },
    { id: "auktionen", group: "Module", label: "Auktionen" },
];

/** The sections this user may open — everything, unless they only hold write on "Einstellungen". */
export function visibleSections(canManageAccess: boolean): SettingsSection[] {
    return canManageAccess ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter((s) => !s.adminOnly);
}

/**
 * The section to open: the remembered one as long as it still exists (an older
 * build's id, or one this user may not see, must not leave every panel hidden),
 * otherwise the first one available.
 */
export function resolveSection(stored: string, sections: SettingsSection[]): string {
    return sections.some((s) => s.id === stored) ? stored : sections[0].id;
}

/** The sections in sidebar order, bundled under their group heading. */
export function groupedSections(sections: SettingsSection[]): { group: string; items: SettingsSection[] }[] {
    const out: { group: string; items: SettingsSection[] }[] = [];
    for (const section of sections) {
        const last = out[out.length - 1];
        if (last && last.group === section.group) last.items.push(section);
        else out.push({ group: section.group, items: [section] });
    }
    return out;
}

/** Whether the page's shared save button belongs under this section. */
export function savesWithForm(sectionId: string): boolean {
    const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId);
    return !!section && !section.standalone;
}
