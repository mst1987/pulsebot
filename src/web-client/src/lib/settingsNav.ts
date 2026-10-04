// The Einstellungen sections in the main menu. The settings page used to carry
// its own section column; now the sections are the children of "Einstellungen"
// in the shell's menu (components/Shell.tsx), and the page only shows the open
// one across the full width. The two share what the column showed:
//
//   * which section is open — the page knows it (url, remembered, legacy id),
//   * the counts of its badges — missing connections, servers that need
//     attention, active raid categories (from the page's draft, so they follow
//     an unsaved edit like the column did).
//
// The page publishes both while it is mounted; the menu reads them. When the
// menu shows the sections on another page and the page never published in this
// visit, the menu loads the settings once itself (loadSettingsNav), so the
// badges say the same as they would on the page.
import { useSyncExternalStore } from "react";
import { getIngestTokens, getSettings, type SettingsData } from "../api";
import type { NavBadge } from "../components/SectionNav";
import { t } from "../i18n";
import { missingConnections, serverIssues } from "./settingsLogic";

/** The counts behind the section badges. */
export type SettingsNavCounts = { verbindungen: number; discordserver: number; kategorien: number };

export type SettingsNavState = {
    counts: SettingsNavCounts | null;
    /** The section the settings page shows; null while it is not mounted. */
    active: string | null;
};

let state: SettingsNavState = { counts: null, active: null };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** The published state right now (outside React: tests, loaders). */
export function getSettingsNav(): SettingsNavState {
    return state;
}

function sameCounts(a: SettingsNavCounts | null, b: SettingsNavCounts | null): boolean {
    if (!a || !b) return a === b;
    return a.verbindungen === b.verbindungen && a.discordserver === b.discordserver && a.kategorien === b.kategorien;
}

/** Updates what the menu shows; a publish that changes nothing wakes nobody. */
export function publishSettingsNav(next: Partial<SettingsNavState>): void {
    const merged = { ...state, ...next };
    if (merged.active === state.active && sameCounts(merged.counts, state.counts)) return;
    state = merged;
    for (const listener of listeners) listener();
}

/** The published state, re-rendering the caller on every change. */
export function useSettingsNav(): SettingsNavState {
    return useSyncExternalStore(subscribe, getSettingsNav, getSettingsNav);
}

/** Back to nothing published — for tests. */
export function resetSettingsNav(): void {
    state = { counts: null, active: null };
    loading = null;
    for (const listener of listeners) listener();
}

type CountSource = {
    data: SettingsData;
    tokens: unknown[] | null;
    canManageAccess: boolean;
    activeCategories: number;
};

/** The badge counts, computed the one way the page and the menu share. */
export function settingsNavCounts({ data, tokens, canManageAccess, activeCategories }: CountSource): SettingsNavCounts {
    return {
        verbindungen: missingConnections(data, tokens, canManageAccess),
        discordserver: serverIssues(data.servers),
        kategorien: activeCategories,
    };
}

/** The badge of one section entry — the same in the menu and in the page's chips. */
export function sectionBadge(id: string, counts: SettingsNavCounts | null): NavBadge | null {
    if (!counts) return null;
    if (id === "verbindungen") return { count: counts.verbindungen, tone: "mid", tip: t("settings.page.badgeConnections", { count: counts.verbindungen }) };
    if (id === "discordserver") return { count: counts.discordserver, tone: "mid", tip: t("settings.page.badgeServers", { count: counts.discordserver }) };
    if (id === "kategorien") return { count: counts.kategorien, tip: t("settings.page.badgeCategories", { count: counts.kategorien }) };
    return null;
}

let loading: Promise<void> | null = null;

/**
 * Loads the counts once per visit for a menu that shows the sections before
 * the settings page ever did. Any failure leaves the badges out — the menu
 * still links every section.
 */
export function loadSettingsNav(canManageAccess: boolean): Promise<void> {
    if (state.counts || loading) return loading || Promise.resolve();
    loading = (async () => {
        try {
            const data = await getSettings();
            const tokens = canManageAccess ? await getIngestTokens().then((r) => r.tokens).catch(() => null) : null;
            // the page may have published in the meantime: its draft wins
            if (state.counts) return;
            publishSettingsNav({
                counts: settingsNavCounts({ data, tokens, canManageAccess: data.canManageAccess, activeCategories: (data.config.categoryIds || []).length }),
            });
        } catch {
            // no badges then
        }
    })();
    return loading;
}
