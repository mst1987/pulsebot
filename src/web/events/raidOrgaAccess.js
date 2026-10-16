// Who is the orga of one raid (#725, #727, docs/permissions.md "Kategorie-Orga") - one rule for every
// answer field and exemption that must say what the `orgaScoped` gate (web/http/apiHandler.js) says:
// the setup editor's `canWrite` (web/setup/setupAccess.js), the signup's `byOrga` (apiRoutes/signups.js:
// deadline, closed signup and the required message do not bind the orga) and the category orga's limits
// on the raid detail's actions (apiRoutes/raidDetail.js) - and since #729 the buttons of the client: the
// raid detail's `viewer.canOrga`, a raid list's `canOrga` per row and `canCreate`, the dashboard's block.
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

/**
 * Whether `user` may create a raid somewhere (#729): the gate of POST /api/raids - the global orga with
 * `raids` write, else a manager of the current roster of some category (it then creates in theirs only).
 * @returns {Promise<boolean>}
 */
async function canCreateRaids(user, req) {
    if (!user) return false;
    if (isGlobalRaidOrga(user)) return true;
    return categoryOrga.isAnyCategoryManager(user, { cache: categoryOrga.requestCache(req) });
}

/**
 * Each row of a raid list with `canOrga` (#729): whether the caller is the orga of that raid - the rule of
 * canOrgaRaid, so a row's button never meets a refusing gate. The global orga with `raids` write is the orga
 * of every row and nothing is looked up; nobody else is unless they manage some current roster
 * (isAnyCategoryManager - a global orga without `raids` write that manages one too) - then each row is asked,
 * its Raid-Helper events found in the list's own `groups`. `canOrga` is about acting; what the global orga
 * may see is the list's `orga` (the page shows its parts to every orga).
 * @param {object} user
 * @param {Array<{ id: string }>} rows
 * @param {object} req
 * @param {{ groups?: object[] }} [opts]
 */
async function withOrgaFlags(user, rows, req, { groups } = {}) {
    const list = rows || [];
    if (isGlobalRaidOrga(user)) return list.map((row) => ({ ...row, canOrga: true }));
    const manager = list.length > 0 && await categoryOrga.isAnyCategoryManager(user, { cache: categoryOrga.requestCache(req) });
    if (!manager) return list.map((row) => ({ ...row, canOrga: false }));
    const loadGroups = groups ? async () => ({ groups }) : undefined;
    const out = [];
    for (const row of list) out.push({ ...row, canOrga: await canOrgaRaid(user, row.id, req, { loadGroups }) });
    return out;
}

module.exports = { isGlobalRaidOrga, canOrgaRaid, canCreateRaids, withOrgaFlags };
