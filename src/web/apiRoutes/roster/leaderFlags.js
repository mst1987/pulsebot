// Leader flags (#1034, docs/roster-profile.md "Raids leiten"): who can lead
// which raids, per Discord account, game version and instance.
//
//   PUT /api/profile/leads  { versionId, instances }
//       The caller's own flags ("Mein Profil"); they count at once, nobody
//       confirms them. The body never names an account.
//   PUT /api/leads          { userId, instances, event? | rosterId? }
//       The orga sets or clears somebody else's flags, from the setup editor
//       (by `event`) or the roster (by `rosterId`). `orgaScoped` like the other
//       setup ways: the global orga, or the orga of that raid's / roster's
//       category - a category orga elsewhere gets 403 not_category_orga. The
//       version comes from the raid or the roster, never from the body, and the
//       account must be signed up for that raid or a member of that roster.
//
// Being orga makes nobody a leader: only a flag does (services/roster/leaderFlags.js).
const { ok, error: apiError } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const leaderFlagsStore = require("../../../stores/roster/leaderFlagsStore");
const { getEvent } = require("../../../stores/events/eventStore");
const { listSignups } = require("../../../stores/events/signupStore");
const rosterStore = require("../../../stores/roster/rosterStore");
const { rosterOfEvent } = require("../../../services/roster/categoryRoster");
const { profileLeadVersions, leadInstances } = require("../../../services/roster/leaderFlags");
const { versionOfEvent } = require("../../../services/versions/mainVersion");
const { signupEventIdOf } = require("../../../utils/raidGroup");
const profiles = require("../../../stores/roster/raiderProfileStore");
const { getConfig } = require("../../../stores/settings/settingsStore");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The own "Raids leiten" part of "Mein Profil": the versions with their instances and flags. */
function ownLeads(userId, config = getConfig()) {
    return profileLeadVersions(userId, profiles.getProfile(userId).characters, { config });
}

/** PUT /api/profile/leads — the caller's own flags of one version. */
const putOwnLeads = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const versionId = str(body.versionId);
    const config = getConfig();
    // only a version the page offers (a played one, or one already flagged)
    if (!ownLeads(user.id, config).some((v) => v.id === versionId)) {
        return apiError(res, 400, "unknown_version", "Unbekannte Spielversion.");
    }
    leaderFlagsStore.setLeads(user.id, versionId, body.instances, { by: user.id });
    ok(res, { leadVersions: ownLeads(user.id, config) });
});

/** The category a `PUT /api/leads` acts in, for `orgaScoped`: the raid, else the roster's category. */
function scopeOf(body) {
    if (str(body.event)) return str(body.event);
    const roster = str(body.rosterId) ? rosterStore.getRoster(str(body.rosterId)) : null;
    return roster && roster.categoryId ? { categoryId: roster.categoryId } : "";
}

/**
 * Where the orga sets a flag: `{ versionId, member }` — the version of the raid
 * or roster and whether `userId` belongs there — or `{ status, code }`.
 */
function targetOf(body, userId) {
    if (str(body.event)) {
        const event = getEvent(str(body.event));
        if (!event) return { status: 404, code: "not_found" };
        const signed = listSignups(signupEventIdOf(event)).some((s) => str(s.userId) === userId);
        const roster = rosterOfEvent(event);
        const inRoster = !!(roster && roster.members && roster.members[userId]);
        return { versionId: versionOfEvent(event), member: signed || inRoster };
    }
    const roster = rosterStore.getRoster(str(body.rosterId));
    if (!roster) return { status: 404, code: "not_found" };
    return { versionId: roster.versionId, member: !!(roster.members && roster.members[userId]) };
}

/** PUT /api/leads — the orga sets (or with an empty list removes) somebody's flags. */
const putLeads = withUser({ orgaScoped: scopeOf, write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const userId = str(body.userId);
    if (!userId) return apiError(res, 400, "missing_user", "Kein Konto angegeben.");
    const target = targetOf(body, userId);
    if (target.status) return apiError(res, target.status, target.code, "Raid oder Roster nicht gefunden.");
    if (!target.member) return apiError(res, 404, "not_member", "Das Konto gehört nicht zu diesem Raid oder Roster.");
    const entry = leaderFlagsStore.setLeads(userId, target.versionId, body.instances, { by: user.id });
    ok(res, { userId, versionId: target.versionId, leads: leadInstances({ [target.versionId]: entry }, target.versionId), by: entry ? entry.by : "", at: entry ? entry.at : 0 });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "PUT", path: "/api/profile/leads", handler: putOwnLeads, area: "signup", scope: "all" },
    { method: "PUT", path: "/api/leads", handler: putLeads, area: "raids" },
];

module.exports = { putOwnLeads, putLeads, ownLeads, scopeOf, routes };
