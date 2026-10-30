import { get, send } from "./client";

// ---- Orga-Zentrale (src/web/apiRoutes/discord/orgaHub.js) ----
// One Discord message per raid category in a channel only the orga sees: the
// category's raids of the next four weeks and where each one stands, with a
// "Raid anlegen" button. Posting again replaces the old message.

export type OrgaHub = { categoryId: string; channelId: string; postedAt: number; url: string };

/** One link button below "Raid anlegen" (at most `maxLinks` per category). */
export type OrgaLink = { label: string; url: string; /** One emoji or a custom "<:name:id>"; none = no emoji. */ emoji?: string };

export function getOrgaHubs(): Promise<{
    hubs: OrgaHub[];
    links?: Record<string, OrgaLink[]>;
    maxLinks?: number;
    /** Categories with a part of their hub switched off (#969); missing = all on. */
    features?: Record<string, Record<string, boolean>>;
    featureKeys?: string[];
}> {
    return get("/api/orga-hubs");
}

/** Switch parts of a category's orga hub on or off (only the keys given change); the posted hub is redrawn at once. */
export function saveOrgaHubFeatures(categoryId: string, features: Record<string, boolean>): Promise<{ categoryId: string; features: Record<string, boolean> }> {
    return send("PUT", "/api/orga-hub/features", { categoryId, features });
}

/** Replace a category's orga links (its posted hub is redrawn at once); empty rows are dropped. */
export function saveOrgaLinks(categoryId: string, links: OrgaLink[]): Promise<{ categoryId: string; links: OrgaLink[] }> {
    return send("PUT", "/api/orga-hub/links", { categoryId, links });
}

export function postOrgaHub(categoryId: string, channelId: string): Promise<{ hub: OrgaHub }> {
    return send("POST", "/api/orga-hub", { categoryId, channelId });
}

export function removeOrgaHub(categoryId: string): Promise<{ categoryId: string }> {
    return send("DELETE", "/api/orga-hub", { categoryId });
}
