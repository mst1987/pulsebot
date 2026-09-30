// The Kaderplaner (docs/kaderplaner.md): raid rosters for WoW Forever, planned
// in the web admin. Area "kader" — in no base access by default, so only full
// admins and the accounts or roles an admin grants it to get in
// (docs/permissions.md). GET reads the whole view model; every write changes the
// planner of the active server and answers with the fresh view model, so the
// page never merges anything itself.
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { q } = require("../http/apiParams");
const kaderStore = require("../../stores/kaderStore");
const model = require("../../services/kader/kaderModel");
const { loadKaderSource } = require("../kader/kaderSource");
const { buildKaderView, mutationContext, publicView } = require("../kader/kaderView");

/** GET /api/kader — the whole view model of the active server. */
const getKader = withUser({}, async ({ req, res }) => {
    const guildId = activeGuildFor(req);
    const source = await loadKaderSource({ guildId });
    ok(res, publicView(buildKaderView({ source, planner: kaderStore.readPlanner(guildId) })));
});

/**
 * A write route: runs a pure mutator of kaderModel.js on the stored planner of
 * the active server and answers with the new view. `mutate(planner, body, ctx)`
 * returns the new planner, or `{ planner, ...extra }` whose extras (the id of
 * what was created) are sent along. A refusal is an AppError the router answers.
 */
function writeRoute(mutate) {
    return withUser({ write: "kader", csrf: true, body: true }, async ({ req, res, body }) => {
        const guildId = activeGuildFor(req);
        const source = await loadKaderSource({ guildId });
        const planner = kaderStore.readPlanner(guildId);
        const result = mutate(planner, body, mutationContext(buildKaderView({ source, planner })));
        const { planner: next, ...extra } = result && result.planner ? result : { planner: result };
        const stored = kaderStore.writePlanner(guildId, next);
        ok(res, { ...publicView(buildKaderView({ source, planner: stored })), ...extra });
    });
}

const str = (body, key) => q.str(body, key);

/** POST /api/kader/accounts — body: { userId, displayName, character?: { nameStyle, firstName, lastName | nickname, className } } */
const addAccount = writeRoute((p, body, ctx) => model.addAccount(p, body, ctx));
/** POST /api/kader/accounts/remove — body: { userId }; only an account added by hand. */
const removeAccount = writeRoute((p, body) => model.removeAccount(p, str(body, "userId")));
/** PUT /api/kader/assignments — body: { userId, characters, activeCharacterId } */
const saveAssignment = writeRoute((p, body, ctx) => model.setAssignment(p, str(body, "userId"), body, ctx));
/** POST /api/kader/assignments/reset — body: { userId }; the profile shows again. */
const resetAssignment = writeRoute((p, body) => model.resetAssignment(p, str(body, "userId")));
/** POST /api/kader/rosters — body: { name, size }; answers `rosterId` too. */
const createRoster = writeRoute((p, body) => model.createRoster(p, body));
/** PUT /api/kader/rosters — body: { rosterId, name?, size?, targets? } */
const updateRoster = writeRoute((p, body) => model.updateRoster(p, str(body, "rosterId"), body));
/** POST /api/kader/rosters/delete — body: { rosterId } */
const deleteRoster = writeRoute((p, body) => model.deleteRoster(p, str(body, "rosterId")));
/** POST /api/kader/rosters/place — body: { rosterId, userId, to: "role"|"bench"|"free", role? } */
const placeInRoster = writeRoute((p, body, ctx) => model.placeInRoster(p, str(body, "rosterId"), body, ctx));
/** POST /api/kader/variants — body: { rosterId, name?, copyFrom? }; answers `variantId` too. */
const addVariant = writeRoute((p, body) => model.addVariant(p, str(body, "rosterId"), body));
/** PUT /api/kader/variants — body: { rosterId, variantId, name?, groups? } */
const saveVariant = writeRoute((p, body) => model.saveVariant(p, str(body, "rosterId"), str(body, "variantId"), body));
/** POST /api/kader/variants/delete — body: { rosterId, variantId } */
const deleteVariant = writeRoute((p, body) => model.deleteVariant(p, str(body, "rosterId"), str(body, "variantId")));
/** POST /api/kader/variants/auto — body: { rosterId, variantId }: "Automatisch verteilen". */
const autoVariant = writeRoute((p, body, ctx) => model.autoAssignVariant(p, str(body, "rosterId"), str(body, "variantId"), ctx));

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/kader", handler: getKader, area: "kader" },
    { method: "POST", path: "/api/kader/accounts", handler: addAccount, area: "kader" },
    { method: "POST", path: "/api/kader/accounts/remove", handler: removeAccount, area: "kader" },
    { method: "PUT", path: "/api/kader/assignments", handler: saveAssignment, area: "kader" },
    { method: "POST", path: "/api/kader/assignments/reset", handler: resetAssignment, area: "kader" },
    { method: "POST", path: "/api/kader/rosters", handler: createRoster, area: "kader" },
    { method: "PUT", path: "/api/kader/rosters", handler: updateRoster, area: "kader" },
    { method: "POST", path: "/api/kader/rosters/delete", handler: deleteRoster, area: "kader" },
    { method: "POST", path: "/api/kader/rosters/place", handler: placeInRoster, area: "kader" },
    { method: "POST", path: "/api/kader/variants", handler: addVariant, area: "kader" },
    { method: "PUT", path: "/api/kader/variants", handler: saveVariant, area: "kader" },
    { method: "POST", path: "/api/kader/variants/delete", handler: deleteVariant, area: "kader" },
    { method: "POST", path: "/api/kader/variants/auto", handler: autoVariant, area: "kader" },
];

module.exports = {
    getKader, addAccount, removeAccount, saveAssignment, resetAssignment,
    createRoster, updateRoster, deleteRoster, placeInRoster,
    addVariant, saveVariant, deleteVariant, autoVariant, routes,
};
