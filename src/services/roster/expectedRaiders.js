// Who is expected in a raid of a category (#658) — the "fehlt" lists (raid
// detail, the dashboard's next raid), "Fehlende pingen" and the reminders.
//
// A category with a roster expects its members with status core or trial;
// bench and pause are not expected (they may still sign up). A category
// without a roster keeps the old rule: everyone holding one of its raider roles
// (categoryRoles.expectedRoleIds, i.e. config.categoryRoles).
//
// With a roster the Discord member list only supplies names: a member the
// readable list does not know has left the server and is dropped; when the list
// cannot be read, the roster's members still count, named by their profile
// (else their id) — the roster is the truth, the names are cosmetic.
//
// One roster per category and version (#739): every function takes the raid's
// version (`versionId`, versionOfEvent) - a raid of the old version still
// expects the closed roster of that version, a raid of the new one its own.
// Without a version: the one the category plays now.
const raiderProfileStore = require("../../stores/roster/raiderProfileStore");
const discord = require("../discord/discord");
const { expectedRoleIds } = require("./categoryRoles");
const { rosterOfCategory } = require("./categoryRoster");

/** The roster statuses that are expected in every raid of the category. */
const EXPECTED_STATUSES = ["core", "trial"];

/**
 * The roster members expected in a raid of the category: their user ids, or
 * null when the category has no roster of that version (then the roles decide).
 * @param {string} categoryId
 * @param {{ versionId?: string, config?: object }} [opts]  the raid's version
 * @returns {string[]|null}
 */
function expectedRosterIds(categoryId, { versionId = "", config } = {}) {
    const roster = rosterOfCategory(categoryId, { versionId, config });
    if (!roster) return null;
    return Object.entries(roster.members)
        .filter(([, m]) => EXPECTED_STATUSES.includes(m.status))
        .map(([userId]) => userId);
}

/** Whether a raid of the category has anybody it expects: a roster, or raider roles. */
function hasExpected(categoryId, config, { versionId = "" } = {}) {
    return expectedRosterIds(categoryId, { versionId, config }) !== null || expectedRoleIds(categoryId, config, { versionId }).length > 0;
}

/**
 * Who is expected in a raid of the category, as `{ id, displayName }`.
 * `source`: "roster" (core + trial of the category's roster), "roles" (holders
 * of the raider roles) or null (neither — nobody is expected). `error` only for
 * the roles (the member list could not be read); `roleIds` the roles asked.
 * @param {string} guildId
 * @param {string} categoryId
 * @param {object} [config]
 * @param {{ versionId?: string }} [opts]  the raid's version (#739)
 * @returns {Promise<{ members: { id: string, displayName: string }[], error: string|null, roleIds: string[], source: "roster"|"roles"|null }>}
 */
async function listExpectedMembers(guildId, categoryId, config, { versionId = "" } = {}) {
    const roleIds = expectedRoleIds(categoryId, config, { versionId });
    const ids = expectedRosterIds(categoryId, { versionId, config });
    if (ids === null) {
        if (!roleIds.length) return { members: [], error: null, roleIds, source: null };
        const { members, error } = await discord.listMembersWithRoles(guildId, roleIds);
        return { members: members || [], error: error || null, roleIds, source: "roles" };
    }
    let known = null;
    try {
        const res = await discord.listHumanMembers(guildId);
        if (!res.error) known = new Map((res.members || []).map((m) => [String(m.id), m]));
    } catch {
        // names fall back to the profiles
    }
    const members = ids
        .filter((id) => !known || known.has(id))
        .map((id) => {
            const dm = known ? known.get(id) : null;
            const profile = raiderProfileStore.getProfile(id);
            return { id, displayName: (dm && dm.displayName) || (profile && profile.name) || id };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { members, error: null, roleIds, source: "roster" };
}

module.exports = { expectedRosterIds, hasExpected, listExpectedMembers, EXPECTED_STATUSES };
