// The counts behind the badges of the Einstellungen sections in the page's icon
// rail (components/SectionRail.tsx): missing connections, servers that need
// attention, active raid categories. The page computes them from its draft, so
// a badge follows an unsaved edit.
import type { NavBadge } from "../components/SectionRail";
import type { SettingsData } from "../api";
import { t } from "../i18n";
import { missingConnections, serverIssues } from "./settingsLogic";

/** The counts behind the section badges. */
export type SettingsNavCounts = { verbindungen: number; discordserver: number; kategorien: number };

type CountSource = {
    data: SettingsData;
    tokens: unknown[] | null;
    canManageAccess: boolean;
    activeCategories: number;
};

/** The badge counts of the settings page. */
export function settingsNavCounts({ data, tokens, canManageAccess, activeCategories }: CountSource): SettingsNavCounts {
    return {
        verbindungen: missingConnections(data, tokens, canManageAccess),
        discordserver: serverIssues(data.servers),
        kategorien: activeCategories,
    };
}

/** The badge of one section's rail button, or null for a section without one. */
export function sectionBadge(id: string, counts: SettingsNavCounts | null): NavBadge | null {
    if (!counts) return null;
    if (id === "verbindungen") return { count: counts.verbindungen, tone: "mid", tip: t("settings.page.badgeConnections", { count: counts.verbindungen }) };
    if (id === "discordserver") return { count: counts.discordserver, tone: "mid", tip: t("settings.page.badgeServers", { count: counts.discordserver }) };
    if (id === "kategorien") return { count: counts.kategorien, tip: t("settings.page.badgeCategories", { count: counts.kategorien }) };
    return null;
}
