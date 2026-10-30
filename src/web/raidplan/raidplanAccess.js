// Who may edit the raid plan of a raid (#726, docs/raidplan/model.md "Permissions") - one rule for the
// editor's answer (web/apiRoutes/events/raidplan.js: `canWrite`, `canWriteLibrary`) and the raid detail's
// "Einteilungen" step (web/apiRoutes/events/raidDetail.js). It mirrors the gate of the plan's routes
// (withUser `orgaScoped` + `globalByWrite`, web/http/apiHandler.js):
//   - `raidplan` write is the global path: every raid's plan - the area is handed to the people who
//     write the tactics, orga rank or not (docs/permissions.md),
//   - else a manager of the current roster of the raid's category (categoryOrga.canOrgaEvent with
//     `managerOnly`) - also a global orga without `raidplan` write, never less than a manager.
// The shared library (templates, tactic profiles, the default room maps, the catalog) stays with
// `raidplan` write alone: `canWriteLibrary`.
const { userCan } = require("../../config/permissions");
const categoryOrga = require("../../services/roster/categoryOrga");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
const { activeGuildFor } = require("../http/activeGuild");

/** `raidplan` write: every raid's plan and the shared library. */
function canWriteLibrary(user) {
    return !!user && userCan(user, "raidplan", "write");
}

/**
 * Whether `user` manages the roster of the raid's category (the category path, without the global
 * right). A Raid-Helper event is resolved through its snapshot, else the event groups of the caller's
 * server - as the gate does. `req` shares the Discord role lookup with the gate (requestCache).
 * @returns {Promise<boolean>}
 */
async function managesRaid(user, event, req) {
    if (!user) return false;
    const id = String((event && typeof event === "object" ? event.id : event) || "").trim();
    if (!id) return false;
    return categoryOrga.canOrgaEvent(user, id, {
        cache: categoryOrga.requestCache(req),
        loadGroups: () => loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() }),
        managerOnly: true,
    });
}

/** Whether `user` may edit the plan of `event` (an id or a row): `raidplan` write, else the category's orga. */
async function canWriteRaidplan(user, event, req) {
    if (!user) return false;
    if (canWriteLibrary(user)) return true;
    return managesRaid(user, event, req);
}

module.exports = { canWriteLibrary, managesRaid, canWriteRaidplan };
