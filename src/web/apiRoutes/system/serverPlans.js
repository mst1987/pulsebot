// The plan of each server (docs/server-plans.md), under "Alle Server" in the settings.
// Full admins only: a server admin neither sees nor changes a plan.
const discord = require("../../../services/discord/discord");
const { serverLabel } = require("../../../services/discord/roles/guildRoles");
const { PLANS } = require("../../../config/plans");
const { MAX_NOTE, planRows, setServerPlan } = require("../../../services/plans/serverPlan");
const store = require("../../../stores/settings/serverPlanStore");
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");

const REFUSALS = {
    unknown_plan: "Unbekannter Tarif.",
    bad_until: "Das Datum ist ungültig.",
    note_too_long: `Die Notiz darf höchstens ${MAX_NOTE} Zeichen lang sein.`,
};

const guilds = () => discord.listGuilds().map((g) => ({ id: g.id, name: serverLabel(g.id) || g.name }));

/**
 * What is certain about the bot and a server. "Not in the cache" only proves that it left
 * while the bot is online: before the login and in an outage Discord cannot answer, and a
 * server with `available === false` stays cached without its data.
 * @returns {"known"|"gone"|"unknown"}
 */
function guildState(guildId) {
    if (!discord.isOnline()) return "unknown";
    if (discord.isGuildAvailable(guildId)) return "known";
    return discord.getGuild(guildId) ? "unknown" : "gone";
}

const view = () => ({
    plans: Object.keys(PLANS),
    maxNote: MAX_NOTE,
    servers: planRows(guilds()).map((row) => ({ ...row, state: guildState(row.guildId) })),
});

/** GET /api/settings/server-plans - every server with its plan. */
const getServerPlans = withUser({ full: true }, async ({ res }) => {
    ok(res, view());
});

/**
 * PUT /api/settings/server-plans - one server's row, answers the table again.
 * Body: { guildId, plan, until: "YYYY-MM-DD" | "", note }.
 */
const putServerPlan = withUser({ full: true, csrf: true, body: true }, async ({ body, res }) => {
    const guildId = String(body.guildId || "");
    // a server the bot is on, or the leftover entry of one it left
    if (!discord.listGuilds().some((g) => g.id === guildId) && !store.getEntry(guildId)) {
        return error(res, 400, "unknown_guild", "Unbekannter Server.");
    }
    const { code } = setServerPlan(guildId, body);
    if (code) return error(res, 400, code, REFUSALS[code]);
    ok(res, view());
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/server-plans", handler: getServerPlans, adminOnly: true },
    { method: "PUT", path: "/api/settings/server-plans", handler: putServerPlan, adminOnly: true },
];

module.exports = { getServerPlans, putServerPlan, routes };
