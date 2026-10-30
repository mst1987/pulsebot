// The stored game version of a raid by its id (#737) — for the records that
// only name their raid: a loot row (characterVersions.eventVersion), a log
// (versionOfLog). Never the live setting: an own event's `versionId`
// (eventStore), a Raid-Helper snapshot's (raidEventStore, stamped by the scan
// or the start-up migration). Switching `mainVersion` or `categoryVersion`
// changes none of them.
//
// Kept apart from mainVersion.js because eventStore requires mainVersion.js
// (a new event's version): asking eventStore from there would close a cycle.
const eventStore = require("../../stores/eventStore");
const { knownVersion, snapshotVersionOf } = require("./mainVersion");

/**
 * The version stored for an event id: an own event's, a Raid-Helper
 * snapshot's — "" when neither store knows one.
 * @param {string} eventId
 * @returns {string} a known version id or ""
 */
function storedVersionOf(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return "";
    if (eventStore.isOwnEventId(id)) {
        const own = eventStore.getEvent(id);
        return knownVersion(own && own.versionId);
    }
    return snapshotVersionOf(id);
}

/**
 * The version of a log: the stored version of the raid it is linked to. A log
 * without a raid (or whose raid nobody stored) belongs to no version: "" —
 * it shows up under "nicht zugeordnet", never in the main version.
 * @param {{ eventId?: string } | null} log
 */
function versionOfLog(log) {
    return storedVersionOf(log && log.eventId);
}

module.exports = { storedVersionOf, versionOfLog };
