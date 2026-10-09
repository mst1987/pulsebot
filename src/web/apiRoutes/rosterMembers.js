// The members of a roster (#655, docs/roster-profile.md "Mitglieder bearbeiten"):
// take someone in, change status / characters / note / trial end, take them out,
// and the Discord member search of the "Mitglied hinzufügen" dialog.
//
// Area `roster` (write for the POSTs, read for the search) is the gate; a
// change needs on top the right to manage that one roster - a full admin or
// one of its managers (rosterAccess.canManageRosterLive), else 403
// "not_manager". Every change writes a history line with the caller as actor
// (rosterStore). Taking in gives the main role, trial also the trial role,
// taking out takes every role of the roster (services/roster/rosterMembers.js).
// Errors answer with a code the client translates (DE/EN).
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const rosterMembers = require("../../services/roster/rosterMembers");
const { searchMembers } = require("../../services/roster/rosterMemberSearch");
const { activeRoster } = require("../roster/activeRoster");
const { knownVersion, mainVersionFor } = require("../../services/events/mainVersion");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

// A refusal's HTTP status; everything not listed is the caller's input (400).
const STATUS_OF_CODE = {
    not_found: 404, not_member: 404, not_manager: 403,
    already_member: 409, member_limit: 409,
    offline: 503, members_unavailable: 503,
};
const MEMBER_FIELDS = ["status", "chars", "charNames", "note", "trialUntil", "spec"];

const refuse = (res, code) => apiError(res, STATUS_OF_CODE[code] || 400, code, `Roster: ${code}`);

/**
 * The roster of a write (on the active server - another server's roster is 404)
 * and the caller's right to manage it: the roster, or null after the refusal was sent.
 */
async function managedRoster(req, res, user, rosterId) {
    const roster = activeRoster(req, rosterId);
    if (!roster) {
        refuse(res, "not_found");
        return null;
    }
    if (!(await canManageRosterLive(user, roster))) {
        refuse(res, "not_manager");
        return null;
    }
    return roster;
}

/**
 * POST /api/rosters/members — take a member in or change one.
 * Body: { rosterId, userId, mode?: "add" | "update", status?, chars?, charNames?, note?, trialUntil?, spec? }
 * `mode` left out: add when the user is no member yet, else update. `chars`:
 * profile keys of the roster's version or names typed by hand, in order (the
 * first counts; one at most without allowMultipleChars -> 400 single_char_only).
 * `spec`: the orga's spec for the first character ("" = automatisch, a spec key
 * of the character's class in the roster's version, else 400 invalid_spec).
 * Answer: { userId, created, member, roles }.
 */
const postRosterMember = withUser({ write: "roster", csrf: true, body: true }, async ({ user, req, body, res }) => {
    const roster = await managedRoster(req, res, user, body.rosterId);
    if (!roster) return undefined;
    const mode = body.mode === undefined || body.mode === null || body.mode === "" ? "" : body.mode;
    if (mode && mode !== "add" && mode !== "update") return refuse(res, "bad_request");
    const userId = str(body.userId);
    const create = mode === "add" || (!mode && !roster.members[userId]);
    const patch = {};
    for (const key of MEMBER_FIELDS) if (body[key] !== undefined) patch[key] = body[key];
    const actor = { actor: str(user.id) };
    const result = create
        ? await rosterMembers.addMember(roster.id, userId, patch, actor)
        : await rosterMembers.updateMember(roster.id, userId, patch, actor);
    if (!result.ok) return refuse(res, result.code);
    return ok(res, { userId, created: create, member: result.member, roles: result.roles });
});

/**
 * POST /api/rosters/members/remove — take a member out (every roster role is taken from them).
 * Body: { rosterId, userId }. Answer: { userId, removed: true, roles }.
 */
const postRosterMemberRemove = withUser({ write: "roster", csrf: true, body: true }, async ({ user, req, body, res }) => {
    const roster = await managedRoster(req, res, user, body.rosterId);
    if (!roster) return undefined;
    const result = await rosterMembers.removeMember(roster.id, str(body.userId), { actor: str(user.id) });
    if (!result.ok) return refuse(res, result.code);
    return ok(res, { userId: str(body.userId), removed: true, roles: result.roles });
});

/**
 * GET /api/rosters/member-search?id=<rosterId>&q=<text>[&version=<id>] — the
 * Discord members of the roster's server matching `q` (display name, account
 * name, a profile character's name), at most 25, non-members first:
 * { results: [{ userId, displayName, inRoster, chars: [{ key, name, className, spec }] }] }.
 * Without `id`: the active server and `version` (default the main version),
 * nobody in a roster (the manager picker of the create dialog).
 * 503 "offline" / "members_unavailable" when the member list cannot be read.
 */
const getRosterMemberSearch = withUser({}, async ({ req, query, res }) => {
    const id = str(query.get("id"));
    let scope;
    if (id) {
        const roster = activeRoster(req, id);
        if (!roster) return refuse(res, "not_found");
        scope = { guildId: roster.guildId, versionId: roster.versionId, members: roster.members };
    } else {
        scope = { guildId: activeGuildFor(req), versionId: knownVersion(query.get("version")) || mainVersionFor(), members: {} };
    }
    const found = await searchMembers({ ...scope, query: str(query.get("q")) });
    if (found.error) return refuse(res, found.error);
    return ok(res, { results: found.results });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "POST", path: "/api/rosters/members", handler: postRosterMember, area: "roster" },
    { method: "POST", path: "/api/rosters/members/remove", handler: postRosterMemberRemove, area: "roster" },
    { method: "GET", path: "/api/rosters/member-search", handler: getRosterMemberSearch, area: "roster" },
];

module.exports = { postRosterMember, postRosterMemberRemove, getRosterMemberSearch, routes, STATUS_OF_CODE };
