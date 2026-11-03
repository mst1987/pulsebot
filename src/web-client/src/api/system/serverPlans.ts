import { get, send } from "../client";

// ---- The plan of each server (src/web/apiRoutes/system/serverPlans.js, docs/server-plans.md) ----
// Full admins only; every change is saved at once and answers the whole table again.

/** What a full admin can set on a server. `until` "YYYY-MM-DD" (holds through that day), "" = no end. */
export type ServerPlanInput = { guildId: string; plan: string; until: string; note: string };

/** One server; `name` is "" when the bot has left it. `expired`: past `until`, so the server is on the default plan. */
export type ServerPlanRow = ServerPlanInput & { name: string; expired: boolean };

export type ServerPlansView = {
    /** The ids of the plans there are. */
    plans: string[];
    maxNote: number;
    servers: ServerPlanRow[];
};

export const getServerPlans = () => get<ServerPlansView>("/api/settings/server-plans");

export function saveServerPlan(input: ServerPlanInput): Promise<ServerPlansView> {
    return send("PUT", "/api/settings/server-plans", input);
}
