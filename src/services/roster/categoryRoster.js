// Which roster of a raid category is meant (#739). A category has one roster
// per game version (rosterStore: unique per category and version), so every
// reader names the version it is about:
//
//   rosterOfEvent(event)        the version of the raid (versionOfEvent, #737) -
//                               signup gate, expected raiders, setup proposal,
//                               attendance overrides, the raid's orga (#723)
//   currentRoster(categoryId)   the version the category plays now - the Discord
//                               roles mirror (config.categoryRoles), the
//                               raider -> character facade, "no roster yet" lists
//   rosterOfCategory(id, { versionId })   a version the caller already knows
//                               (the council's, a view's); none = the current one
//
// Closed rosters (rosterStore.closeRoster) are found too: a raid of the old
// version still belongs to the closed roster of that version. Who must skip
// them (role sync, mirroring) asks rosterStore.isClosed.
const rosterStore = require("../../stores/rosterStore");
const { versionOfEvent, mainVersionFor, knownVersion } = require("../events/mainVersion");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The version a category plays now (its section, categoryEras.currentEra - the same setting). */
function currentVersionOf(categoryId, { config } = {}) {
    return mainVersionFor({ categoryId: str(categoryId), config });
}

/** The roster of a category in `versionId` (a known one), else in the version it plays now; null without one. */
function rosterOfCategory(categoryId, { versionId = "", config } = {}) {
    const cat = str(categoryId);
    if (!cat) return null;
    return rosterStore.rosterForCategory(cat, knownVersion(versionId) || currentVersionOf(cat, { config }));
}

/** The roster of the version a category plays now, or null. */
function currentRoster(categoryId, { config } = {}) {
    return rosterOfCategory(categoryId, { config });
}

/** The roster of a raid: its category's roster of the raid's version (#737 stored version), or null. */
function rosterOfEvent(event, { config } = {}) {
    const cat = str(event && event.categoryId);
    if (!cat) return null;
    return rosterStore.rosterForCategory(cat, versionOfEvent(event, { config }));
}

/** Whether a roster is the open roster of the version its category plays now - the one that mirrors and syncs. */
function isCurrentRoster(roster, { config } = {}) {
    if (!roster || !roster.categoryId || rosterStore.isClosed(roster)) return false;
    return roster.versionId === currentVersionOf(roster.categoryId, { config });
}

module.exports = { rosterOfCategory, currentRoster, rosterOfEvent, currentVersionOf, isCurrentRoster };
