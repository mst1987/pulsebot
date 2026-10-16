// Who is the orga of one raid (#725, #727, docs/permissions.md "Kategorie-Orga") - one rule for every
// answer field and exemption that must say what the `orgaScoped` gate (web/http/apiHandler.js) says:
// the setup editor's `canWrite` (web/setup/setupAccess.js), the signup's `byOrga` (apiRoutes/signups.js:
// deadline, closed signup and the required message do not bind the orga) and the category orga's limits
// on the raid detail's actions (apiRoutes/raidDetail.js).
//
//   - the global orga (permissions.userIsOrga) with `raids` write: every raid,
//   - else a manager of the current roster of the raid's category in the raid's version
//     (categoryOrga.canOrgaEvent with `managerOnly`) - never more than the gate lets through.
// A raider role holding `raids` write but no orga rank is neither.
const { userCan, userIsOrga } = require("../../config/permissions");
const categoryOrga = require("../../services/roster/categoryOrga");

/** The global orga with `raids` write: the orga of every raid. */
function isGlobalRaidOrga(user) {
    return !!user && userIsOrga(user) && userCan(user, "raids", "write");
}

/**
 * Whether `user` is the orga of `event` (an own event's row or id, or a Raid-Helper event's id). `req`
 * shares the Discord role lookup with the gate of the same request (categoryOrga.requestCache);
 * `loadGroups` finds a Raid-Helper event without snapshot (raidEventGroups.loadEventGroups).
 * @returns {Promise<boolean>}
 */
async function canOrgaRaid(user, event, req, { loadGroups } = {}) {
    if (!user) return false;
    if (isGlobalRaidOrga(user)) return true;
    const id = event && typeof event === "object" ? event.id : event;
    if (!id) return false;
    const opts = { cache: categoryOrga.requestCache(req), managerOnly: true };
    if (typeof loadGroups === "function") opts.loadGroups = loadGroups;
    return categoryOrga.canOrgaEvent(user, String(id), opts);
}

module.exports = { isGlobalRaidOrga, canOrgaRaid };
