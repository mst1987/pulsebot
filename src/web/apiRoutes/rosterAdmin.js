// Creating, setting up and deleting raid rosters, and their composition (#657,
// docs/roster-profile.md "Roster anlegen und einstellen").
//
// Area `roster` is the gate (write for the POSTs, read for the GETs). On top:
//   create, delete            full admins only, else 403 "admin_only"
//   update                    full admins everything; a manager of that roster
//                             (rosterAccess.canManageRosterLive) its name, slots,
//                             allowMultipleChars and signupOnly - a changed
//                             admin-only field answers 403 "admin_only", anyone
//                             else 403 "not_manager" (services/roster/rosterSettings.js)
// A roster of another server than the active one is 404 "not_found" for
// update, delete and composition (web/roster/activeRoster.js).
// Errors answer with a code the client translates (DE/EN).
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { userCan } = require("../../config/permissions");
const rosterStore = require("../../stores/rosterStore");
const { getConfig } = require("../../stores/settingsStore");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const { createRosterWithSource, kaderExists } = require("../../services/roster/rosterCreate");
const { updateRosterSettings } = require("../../services/roster/rosterSettings");
const { rosterOptions, serverRoles } = require("../../services/roster/rosterOptions");
const { rosterComposition } = require("../../services/roster/rosterComposition");
const { activeRoster } = require("../roster/activeRoster");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

// A refusal's HTTP status; everything not listed is the caller's input (400).
const STATUS_OF_CODE = {
    not_found: 404, kader_not_found: 404,
    admin_only: 403, not_manager: 403,
    category_taken: 409, kader_taken: 409,
};

const refuse = (res, code) => apiError(res, STATUS_OF_CODE[code] || 400, code, `Roster: ${code}`);

/** The role ids of a server when the bot can see it (to refuse unknown ones), else null. */
function knownRoleIds(guildId) {
    const roles = serverRoles(guildId);
    return roles.length ? new Set(roles.map((r) => r.id)) : null;
}

/**
 * GET /api/rosters/options — what the create dialog and the settings offer for
 * the active server: { guildId, categories: [{ id, name, versionId, rosterId, rosterName }],
 * versions: [{ id, label, short }], defaultVersion, roles: [{ id, name, color, position, manageable }],
 * canManageRoles, online, kaders: [{ id, name, inRoster, candidates }] (only with `kader` read),
 * templateSlots: { [categoryId]: { total, tank, healer, bench, templateId, templateName } }, isAdmin }.
 */
const getRosterOptions = withUser({}, async ({ user, req, res }) => {
    const options = rosterOptions({ guildId: activeGuildFor(req), config: getConfig(), canSeeKader: userCan(user, "kader", "read") });
    // #676: the Loot-Council profiles to pick from (names only) and whether "Profile verwalten" may link to the council
    return ok(res, { ...options, isAdmin: user.isAdmin === true, canOpenCouncil: userCan(user, "lootcouncil", "read") });
});

/**
 * POST /api/rosters/create — a new roster on the active server (full admins).
 * Body: { name?, categoryId?, versionId?, roleIds?, trialRoleId?, managers?: { roleIds, userIds },
 *   slots?: { total, tank, healer, bench }, allowMultipleChars?, signupOnly?,
 *   source?: "role" | "kader" | "raids" | "none", kaderId? }.
 * Answer: { roster, initial: { source, added, skipped, roleFailures: [{ userId, roleId, code }], error } }.
 */
const postRosterCreate = withUser({ write: "roster", csrf: true, body: true }, async ({ user, req, body, res }) => {
    if (user.isAdmin !== true) return refuse(res, "admin_only");
    const guildId = activeGuildFor(req);
    const result = await createRosterWithSource(body, { guildId, actor: str(user.id), config: getConfig(), knownRoleIds: knownRoleIds(guildId) });
    if (!result.ok) return refuse(res, result.code);
    return ok(res, { roster: result.roster, initial: result.initial });
});

/**
 * POST /api/rosters/update — change a roster's settings.
 * Body: { rosterId, name?, categoryId?, versionId?, roleIds?, trialRoleId?, managers?, slots?,
 *   allowMultipleChars?, signupOnly?, publicRaids?, kaderId? } (only what is sent changes; slots and managers merge per key).
 * `kaderId` (full admins): the Kader of the Kaderplaner linked 1:1 (null unlinks; 404 kader_not_found,
 * 409 kader_taken when another roster holds it).
 * `lootSystem` (full admins, #676): "softres" | "lootcouncil" | "gdkp" | "other" - with a category it is
 * written to config.categoryLootSystem; 400 invalid_loot_system. `lootProfileId` (admins and the roster's
 * managers): a Loot-Council profile id, "" = the default profile; 400 unknown_profile.
 * Answer: { roster, trimmedChars } (members cut to one character by switching allowMultipleChars off).
 */
const postRosterUpdate = withUser({ write: "roster", csrf: true, body: true }, async ({ user, req, body, res }) => {
    const roster = activeRoster(req, body.rosterId);
    if (!roster) return refuse(res, "not_found");
    const isAdmin = user.isAdmin === true;
    if (!isAdmin && !(await canManageRosterLive(user, roster))) return refuse(res, "not_manager");
    // rosterId is no settings field - cleanSettings ignores it like any unknown field
    const result = updateRosterSettings(roster.id, body, {
        isAdmin, actor: str(user.id), knownRoleIds: knownRoleIds(roster.guildId), kaderKnown: (id) => kaderExists(roster.guildId, id),
        config: getConfig(),
    });
    if (!result.ok) return refuse(res, result.code);
    return ok(res, { roster: result.roster, trimmedChars: result.trimmedChars });
});

/**
 * POST /api/rosters/delete — delete a roster (full admins). The Discord roles
 * stay where they are, nobody's roles are touched; the category's raider roles
 * in the settings keep the roster's last roles. Body: { rosterId }. Answer: { rosterId, deleted: true }.
 */
const postRosterDelete = withUser({ write: "roster", csrf: true, body: true }, async ({ user, req, body, res }) => {
    if (user.isAdmin !== true) return refuse(res, "admin_only");
    const id = str(body.rosterId);
    if (!activeRoster(req, id) || !rosterStore.deleteRoster(id)) return refuse(res, "not_found");
    return ok(res, { rosterId: id, deleted: true });
});

/**
 * GET /api/rosters/composition?id=<rosterId> — the Komposition tab
 * (services/roster/rosterComposition.js) plus whether the caller may manage the roster.
 */
const getRosterComposition = withUser({}, async ({ user, req, query, res }) => {
    const roster = activeRoster(req, query.get("id"));
    if (!roster) return refuse(res, "not_found");
    return ok(res, { ...rosterComposition(roster), canManage: await canManageRosterLive(user, roster) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/rosters/options", handler: getRosterOptions, area: "roster" },
    { method: "POST", path: "/api/rosters/create", handler: postRosterCreate, area: "roster" },
    { method: "POST", path: "/api/rosters/update", handler: postRosterUpdate, area: "roster" },
    { method: "POST", path: "/api/rosters/delete", handler: postRosterDelete, area: "roster" },
    { method: "GET", path: "/api/rosters/composition", handler: getRosterComposition, area: "roster" },
];

module.exports = { getRosterOptions, postRosterCreate, postRosterUpdate, postRosterDelete, getRosterComposition, routes, STATUS_OF_CODE };
