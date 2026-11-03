import { get, send } from "../client";

// ---- The plan of each server (src/web/apiRoutes/system/serverPlans.js, docs/server-plans.md) ----
// Full admins only; every change is saved at once and answers the whole table again.

/** What a full admin can set on a server. `until` "YYYY-MM-DD" (holds through that day), "" = no end. */
export type ServerPlanInput = { guildId: string; plan: string; until: string; note: string };

/**
 * One server; `name` is "" when no name is known. `expired`: past `until`, so the server is on the default plan.
 * `state`: "gone" only when the bot has certainly left, "unknown" while Discord does not answer.
 */
export type ServerPlanRow = ServerPlanInput & { name: string; expired: boolean; state: "known" | "gone" | "unknown" };

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
