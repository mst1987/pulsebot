// "Alle Charaktere" — the orga's tab on the profile page: every character of
// every raider profile in one list, and editing any of them (name, realm,
// class, specs, gear, the two switches) or taking one out. Area `roster`
// (reading lists, writing edits) and the orga besides (config/permissions.js
// userIsOrga), the same as the orga's read-only view of one profile.
//
// The raider's own edits go through POST /api/profile/characters (apiRoutes/
// profile.js); both end in services/characters/characterEdit.js, which moves
// what hangs on a renamed character.
const { ok, error: apiError } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const profiles = require("../../../stores/roster/raiderProfileStore");
const { profileView } = require("../../characters/profileView");
const { logIndex, logSuggestions } = require("../../characters/profileLogs");
const { seenIndex } = require("../../../services/characters/characterEvidence");
const { editProfileCharacter } = require("../../../services/characters/characterEdit");
const { userIsOrga } = require("../../../config/permissions");
const { editInput, nearOf } = require("./profile");
const { activeGuildFor } = require("../../http/activeGuild");

const notOrga = (res) => apiError(res, 403, "orga_only", "Nur die Orga darf das.");

/** One raider as the list shows them: the account and its characters (profileView's shape). */
function raiderView(profile, ctx) {
    const view = profileView(profile, ctx);
    return { userId: view.userId, name: view.name, characters: view.characters };
}

/** The target of a write: `{ userId, key }` of an existing character, else the error already sent. */
function targetOf(body, res) {
    const userId = String(body.userId || "").trim();
    const key = String(body.key || "").trim();
    if (!userId || !profiles.hasProfile(userId)) return apiError(res, 404, "not_found", "Kein Profil für dieses Konto.");
    if (!profiles.findCharacter(profiles.getProfile(userId), key)) return apiError(res, 404, "not_found", "Diesen Charakter gibt es im Profil nicht.");
    return { userId, key };
}

/** The raider after a write, fresh. */
const raiderAfter = (userId) => raiderView(profiles.getProfile(userId), {});

/** GET /api/characters — every raider with at least one character, by name. */
const getCharacters = withUser({}, async ({ user, req, res }) => {
    if (!userIsOrga(user)) return notOrga(res);
    const all = profiles.listProfiles();
    // guildId (#923): armory links of the server the page is shown for
    const ctx = { all, index: logIndex(), seen: seenIndex(), guildId: activeGuildFor(req) };
    const raiders = all
        .filter((p) => p.characters.length)
        .map((p) => raiderView(p, ctx))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));
    ok(res, { raiders });
});

/**
 * GET /api/characters/log-suggestions?userId=&key=&q= — the logged characters
 * that raider could be (as the raider's own "aus den Logs" sees them), the
 * names that look like a typo of character `key` first.
 */
const getLogSuggestions = withUser({}, async ({ user, res, url }) => {
    if (!userIsOrga(user)) return notOrga(res);
    const userId = String(url.searchParams.get("userId") || "").trim();
    if (!userId || !profiles.hasProfile(userId)) return apiError(res, 404, "not_found", "Kein Profil für dieses Konto.");
    const profile = profiles.getProfile(userId);
    const q = String(url.searchParams.get("q") || "").slice(0, 32);
    const near = nearOf(userId, String(url.searchParams.get("key") || "").slice(0, 80));
    ok(res, { characters: logSuggestions({ id: userId, name: profile.name }, { query: q, near }) });
});

/** POST /api/characters/edit — { userId, key, name?, realm?, className?, specs? } | { userId, key, fromLog }: who the character is. */
const postEdit = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    if (!userIsOrga(user)) return notOrga(res);
    const target = targetOf(body, res);
    if (!target) return;
    const asked = editInput(body, profiles.findCharacter(profiles.getProfile(target.userId), target.key));
    if (asked.error) return apiError(res, asked.status, asked.code, asked.error);
    const edited = editProfileCharacter(target.userId, target.key, asked.input, { actor: String(user.id || "") });
    if (edited.error) return apiError(res, edited.code === "not_found" ? 404 : 400, edited.code, edited.error);
    ok(res, { key: edited.character.key, renamed: edited.renamed, moved: edited.moved, raider: raiderAfter(target.userId) });
});

/** POST /api/characters/save — { userId, key, specs?, canOfftank?, canHeal? }: gear per spec and the two switches. */
const postSave = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    if (!userIsOrga(user)) return notOrga(res);
    const target = targetOf(body, res);
    if (!target) return;
    const edit = { key: profiles.findCharacter(profiles.getProfile(target.userId), target.key).key };
    if (Array.isArray(body.specs)) edit.specs = body.specs;
    for (const field of ["canOfftank", "canHeal"]) {
        if (body[field] !== undefined) edit[field] = body[field] === null ? null : body[field] === true;
    }
    profiles.saveProfile(target.userId, { characters: [edit] });
    ok(res, { raider: raiderAfter(target.userId) });
});

/** POST /api/characters/remove — { userId, key }: take the character out of that profile. */
const postRemove = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    if (!userIsOrga(user)) return notOrga(res);
    const target = targetOf(body, res);
    if (!target) return;
    const removed = profiles.removeCharacter(target.userId, profiles.findCharacter(profiles.getProfile(target.userId), target.key).key);
    ok(res, { removed, raider: raiderAfter(target.userId) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/characters", handler: getCharacters, area: "roster" },
    { method: "GET", path: "/api/characters/log-suggestions", handler: getLogSuggestions, area: "roster" },
    { method: "POST", path: "/api/characters/edit", handler: postEdit, area: "roster" },
    { method: "POST", path: "/api/characters/save", handler: postSave, area: "roster" },
    { method: "POST", path: "/api/characters/remove", handler: postRemove, area: "roster" },
];

module.exports = { getCharacters, getLogSuggestions, postEdit, postSave, postRemove, routes };
