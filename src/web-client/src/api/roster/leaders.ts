import { send } from "../client";

// Leader flags (#1034): who can lead raids of which instance, per game version.
// Set by the person in "Mein Profil" (counts at once) or by the orga for
// somebody else, from the setup editor (by raid) or the roster (by roster).
// Being orga makes nobody a leader — only a flag does.

/** An instance a flag can name, as the chips draw it. */
export type LeadInstance = { id: string; name: string; short: string; icon: string };

/** One version of "Mein Profil › Raids leiten": its instances and the own flag. */
export type LeadVersion = {
    id: string;
    label: string;
    short: string;
    instances: LeadInstance[];
    /** The instance ids the person leads in this version (empty = none). */
    leads: string[];
    /** Who set the flag last (the person themselves or an orga) and when (ms). */
    by: string;
    at: number;
};

/** The leaders a view marks: the version's instances and the flags by user id (only people with one). */
export type LeadersView = { versionId?: string; instances: LeadInstance[]; byUser: Record<string, string[]> };

/** The caller's own flags of one version; an empty list removes them. */
export function saveOwnLeads(versionId: string, instances: string[]): Promise<{ leadVersions: LeadVersion[] }> {
    return send("PUT", "/api/profile/leads", { versionId, instances });
}

/** The orga sets (or with an empty list removes) somebody's flags — of the raid's or the roster's version. */
export function setLeads(input: { userId: string; instances: string[]; event?: string; rosterId?: string }): Promise<{ userId: string; versionId: string; leads: string[]; by: string; at: number }> {
    return send("PUT", "/api/leads", input);
}
