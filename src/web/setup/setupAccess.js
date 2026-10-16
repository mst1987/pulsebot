// Who may edit the setup of a raid (#725, docs/setup.md "Who is the orga of a setup") - one rule for
// the setup editor's API (web/apiRoutes/setup.js: `canWrite`, the draft) and the "Comp" link of the
// event message (web/http/pageRoutes.js `/e/<id>/comp`: into the editor or onto the public page).
// It is the orga of the raid (web/events/raidOrgaAccess.js, #727), which mirrors the `orgaScoped`
// gate: the global orga with `raids` write for every raid, else a manager of the current roster of
// the raid's category - a raider role holding `raids` write but no orga rank is neither.
const { isGlobalRaidOrga, canOrgaRaid } = require("../events/raidOrgaAccess");

/** The global orga with `raids` write: every raid's setup. */
const isGlobalSetupOrga = isGlobalRaidOrga;

/**
 * Whether `user` may edit the setup of `event` (an own event's row or id). `req` shares the Discord
 * role lookup with the gate of the same request (categoryOrga.requestCache).
 * @returns {Promise<boolean>}
 */
function canWriteSetup(user, event, req) {
    return canOrgaRaid(user, event, req);
}

module.exports = { isGlobalSetupOrga, canWriteSetup };
