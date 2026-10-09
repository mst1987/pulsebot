// The content switch of the menu (#563) as pure rules: which game version the
// whole web admin shows. One global choice instead of a version filter on every
// page (#545) — the pages read it through hooks/useContentVersion and send it
// to the server as `?version=`, which keeps resolving it the same way.
//
//   * the default is the main version from the settings;
//   * each user's pick is remembered in this browser (localStorage, best
//     effort: private mode or a blocked store just start on the default);
//   * a remembered version that is no longer offered (hidden, or without data)
//     falls back to the main version;
//   * with "Andere Versionen ausblenden" on there is nothing to pick.
import type { ContentInfo, ContentVersionRef } from "../../api/session";

export const CONTENT_VERSION_KEY = "eh-content-version";

/** No session content (a test, an older server): the server decides (`?version=` left out). */
export const EMPTY_CONTENT: ContentInfo = { mainVersion: "", hideOtherVersions: false, versions: [] };

/** The remembered pick, "" when there is none or the store cannot be read. */
export function readStoredVersion(): string {
    try {
        const raw = window.localStorage.getItem(CONTENT_VERSION_KEY);
        return typeof raw === "string" ? raw : "";
    } catch {
        return "";
    }
}

/** Remembers a pick; the main version is stored as "" so a later switch of the main version is followed. */
export function writeStoredVersion(versionId: string, info: ContentInfo): void {
    try {
        if (!versionId || versionId === info.mainVersion) window.localStorage.removeItem(CONTENT_VERSION_KEY);
        else window.localStorage.setItem(CONTENT_VERSION_KEY, versionId);
    } catch {
        // storage unavailable: the pick lasts until the next reload
    }
}

/** The version the menu shows: the pick when it is offered, else the main version ("" without session content). */
export function resolveContentVersion(picked: string, info: ContentInfo): string {
    if (info.hideOtherVersions) return info.mainVersion;
    if (picked && info.versions.some((v) => v.id === picked)) return picked;
    return info.mainVersion;
}

/** Whether the switch is shown at all: only with a choice to make. */
export function canSwitch(info: ContentInfo): boolean {
    return !info.hideOtherVersions && info.versions.length > 1;
}

/** The entry of a version for its label, or a bare one from the id. */
export function versionRef(info: ContentInfo, id: string): ContentVersionRef {
    return info.versions.find((v) => v.id === id) || { id, label: id, short: id };
}

export type UpcomingRaidRef = { id: string; title: string; startTime: number };

/**
 * The coming raids of every version but `mainVersion`, soonest first: what
 * "Andere Versionen ausblenden" would take out of the lists (the settings'
 * warning). `upcoming` is GET /api/settings' `upcomingByVersion`.
 */
export function otherUpcoming(upcoming: Record<string, UpcomingRaidRef[]> | undefined, mainVersion: string): UpcomingRaidRef[] {
    return Object.entries(upcoming || {})
        .filter(([id]) => id !== mainVersion)
        .flatMap(([, rows]) => rows)
        .sort((a, b) => a.startTime - b.startTime);
}
