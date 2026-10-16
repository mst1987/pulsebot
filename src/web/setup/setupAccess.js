// Who may edit the setup of a raid (#725, docs/setup.md "Who is the orga of a setup") - one rule for
// the setup editor's API (web/apiRoutes/setup.js: `canWrite`, the draft) and the "Comp" link of the
// event message (web/http/pageRoutes.js `/e/<id>/comp`: into the editor or onto the public page).
// It mirrors the `orgaScoped` gate (web/http/apiHandler.js): the global orga with `raids` write for
// every raid, else a manager of the current roster of the raid's category (categoryOrga.canOrgaEvent
// with `managerOnly`) - a raider role holding `raids` write but no orga rank is neither.
const { userCan, userIsOrga } = require("../../config/permissions");
const categoryOrga = require("../../services/roster/categoryOrga");

/** The global orga with `raids` write: every raid's setup - and the event itself (PATCH /api/raids, until #728). */
function isGlobalSetupOrga(user) {
    return !!user && userIsOrga(user) && userCan(user, "raids", "write");
}

/**
 * Whether `user` may edit the setup of `event` (an own event's row or id). `req` shares the Discord
 * role lookup with the gate of the same request (categoryOrga.requestCache).
 * @returns {Promise<boolean>}
 */
async function canWriteSetup(user, event, req) {
    if (!user) return false;
    if (isGlobalSetupOrga(user)) return true;
    const id = event && typeof event === "object" ? event.id : event;
    if (!id) return false;
    return categoryOrga.canOrgaEvent(user, String(id), { cache: categoryOrga.requestCache(req), managerOnly: true });
}

module.exports = { isGlobalSetupOrga, canWriteSetup };
