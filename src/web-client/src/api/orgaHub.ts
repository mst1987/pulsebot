import { get, send } from "./client";

// ---- Orga-Zentrale (src/web/apiRoutes/orgaHub.js) ----
// One Discord message per raid category in a channel only the orga sees: the
// category's raids of the next four weeks and where each one stands, with a
// "Raid anlegen" button. Posting again replaces the old message.

export type OrgaHub = { categoryId: string; channelId: string; postedAt: number; url: string };

/** One link button below "Raid anlegen" (at most `maxLinks` per category). */
export type OrgaLink = { label: string; url: string };

export function getOrgaHubs(): Promise<{ hubs: OrgaHub[]; links?: Record<string, OrgaLink[]>; maxLinks?: number }> {
    return get("/api/orga-hubs");
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
