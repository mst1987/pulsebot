// Roles & onboarding of a PuG server (#906, services/discord/pugOnboarding.js,
// docs/discord-servers.md): the version and class roles, the rights of the PuG categories
// and the onboarding questions, compared with what Discord has, and taken over on request.
// Full admins only (area `settings`, full: true): the button changes roles, category
// rights and the server's onboarding in Discord.
//
// GET  /api/discord/pug-onboarding?guildId=<one of the servers>   (none: the first server)
//      → { data: Overview }   (offline: { guildId, guildName: "", online: false, applied })
//        Overview = { guildId, guildName, online, applied, pugCategories, otherCategories,
//                     roles, prompts, categories, changes, onboarding, onboardingError,
//                     prerequisites }   (shapes: services/discord/pugOnboarding.js)
//
// POST /api/discord/pug-onboarding   { guildId }
//      → { data: { done: { roles, categories, onboarding }, overview: Overview } }
//      409 offline | no_pug_category | no_community | missing_permissions | role_above_bot
//      502 onboarding_unreadable | discord_failed (the message names the step and what was done)
//      400 unknown_guild outside the server list
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { serverFromQuery } = require("../http/serverQuery");
const pugOnboarding = require("../../services/discord/pugOnboarding");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** GET /api/discord/pug-onboarding */
const getOverview = withUser({ full: true }, async ({ query, res }) => {
    const guildId = serverFromQuery(query, res);
    if (guildId === null) return undefined;
    ok(res, await pugOnboarding.overview(guildId));
    return undefined;
});

/** POST /api/discord/pug-onboarding */
const postApply = withUser({ full: true, csrf: true, body: true }, async ({ user, body, res }) => {
    const guildId = serverFromQuery(new URLSearchParams({ guildId: str(body && body.guildId) }), res);
    if (guildId === null) return undefined;
    try {
        ok(res, await pugOnboarding.apply(guildId, { actor: str(user && (user.name || user.id)) }));
    } catch (e) {
        if (e instanceof pugOnboarding.PugOnboardingError) return apiError(res, e.status, e.code, e.message);
        throw e;
    }
    return undefined;
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/discord/pug-onboarding", handler: getOverview, area: "settings" },
    { method: "POST", path: "/api/discord/pug-onboarding", handler: postApply, area: "settings" },
];

module.exports = { routes };
