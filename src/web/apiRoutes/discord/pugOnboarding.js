// Roles & onboarding of a PuG server (#906, services/discord/pugOnboarding.js,
// docs/discord-servers.md): the version and class roles, the rights of the PuG categories
// and the onboarding questions, compared with what Discord has, and taken over on request.
// Full admins only (area `settings`, full: true): the button changes roles, category
// rights and the server's onboarding in Discord.
//
// GET  /api/discord/pug-onboarding?guildId=<one of the servers>&categories=<id,id>
//      (no guildId: of the servers with the switch "PuG-Server" the first with a PuG category,
//       else the first marked one, else the first server; no categories: every PuG category, "" = none)
//      → { data: Overview }   (offline: { guildId, guildName: "", online: false, applied };
//        a server without the switch: { guildId, guildName, online, applied, notPugServer: true })
//        Overview = { guildId, guildName, online, applied, pugCategories, otherCategories,
//                     roles, prompts, categories, changes, onboarding, onboardingError,
//                     prerequisites, fingerprint }   (shapes: services/discord/pugOnboarding.js)
//
// POST /api/discord/pug-onboarding   { guildId, categoryIds: string[], fingerprint }
//      (fingerprint: the one of the preview the orga saw; categoryIds: the switched-on ones)
//      → { data: { done: { roles, categories, channels, onboarding }, overview: Overview } }
//      409 not_pug_server | offline | busy | changed | no_pug_category | no_community | missing_permissions
//          | role_above_bot | category_access | role_privileged | default_channel_hidden
//      502 onboarding_unreadable | discord_failed (the message names the step and what was done)
//      400 unknown_guild outside the server list | fingerprint_required | no_category_selected
const { ok, error: apiError } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { serverFromQuery } = require("../../http/serverQuery");
const pugOnboarding = require("../../../services/discord/pugOnboarding");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** GET /api/discord/pug-onboarding */
const getOverview = withUser({ full: true }, async ({ user, req, query, res }) => {
    const guildId = str(query.get("guildId")) ? serverFromQuery(query, res, { user, req }) : (pugOnboarding.firstPugServer() || serverFromQuery(query, res, { user, req }));
    if (guildId === null) return undefined;
    const raw = query.get("categories");
    const categoryIds = raw === null ? undefined : raw.split(",").map(str).filter(Boolean);
    ok(res, await pugOnboarding.overview(guildId, undefined, { categoryIds }));
    return undefined;
});

/** POST /api/discord/pug-onboarding */
const postApply = withUser({ full: true, csrf: true, body: true }, async ({ user, req, body, res }) => {
    const guildId = serverFromQuery(new URLSearchParams({ guildId: str(body && body.guildId) }), res, { user, req });
    if (guildId === null) return undefined;
    try {
        const b = body || {};
        const categoryIds = Array.isArray(b.categoryIds) ? b.categoryIds.map(str).filter(Boolean) : [];
        ok(res, await pugOnboarding.apply(guildId, {
            actor: str(user && (user.name || user.id)), categoryIds, fingerprint: str(b.fingerprint),
        }));
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
