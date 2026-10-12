import { get, send } from "./client";

// ---- Orga-Zentrale (src/web/apiRoutes/orgaHub.js) ----
// One Discord message per raid category in a channel only the orga sees: the
// category's raids of the next four weeks and where each one stands, with a
// "Raid anlegen" button. Posting again replaces the old message.

export type OrgaHub = { categoryId: string; channelId: string; postedAt: number; url: string };

export function getOrgaHubs(): Promise<{ hubs: OrgaHub[] }> {
    return get("/api/orga-hubs");
}

export function postOrgaHub(categoryId: string, channelId: string): Promise<{ hub: OrgaHub }> {
    return send("POST", "/api/orga-hub", { categoryId, channelId });
}

export function removeOrgaHub(categoryId: string): Promise<{ categoryId: string }> {
    return send("DELETE", "/api/orga-hub", { categoryId });
}
