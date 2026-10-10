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

/**
 * What a page about one record of a game version (a raid, a Kader, a roster)
 * does with the menu's content version (#741, strictly one version at a time):
 *
 *   "switch"  the record is of another version the switch offers: switch the
 *             menu to it (a link from Discord or a bookmark) and say so;
 *   "mark"    a record seen the first time that needs no switch (its version is
 *             shown, or not offered — hidden or without data): remember it;
 *   "leave"   the record was followed and the user switched away from its
 *             version: the record is not of the version shown any more, go back
 *             to the list;
 *   "stay"    nothing to do (no record yet, outside the shell, nothing changed).
 *
 * `record` is the record's version, or the versions it can be shown in, the
 * preferred first (a character with loot in two versions); `followed` the
 * `key` of what the page already followed ("" = nothing yet); `to` the version
 * a "switch" goes to.
 */
export type FollowStep = "switch" | "mark" | "leave" | "stay";
export type FollowDecision = { step: FollowStep; to: string; key: string };

export function followStep({ record, shown, followed, offered }: {
    record: string | string[]; shown: string; followed: string; offered: string[];
}): FollowDecision {
    const list = (Array.isArray(record) ? record : [record]).filter(Boolean);
    const key = list.join(",");
    if (!list.length || !shown) return { step: "stay", to: "", key };
    if (followed !== key) {
        if (list.includes(shown)) return { step: "mark", to: "", key };
        const to = list.find((v) => offered.includes(v)) || "";
        return to ? { step: "switch", to, key } : { step: "mark", to: "", key };
    }
    return { step: list.includes(shown) ? "stay" : "leave", to: "", key };
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
