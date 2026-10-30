// Who can lead which raids: per Discord account, per game version, the instances
// the person says (or the orga says) they can lead (#1034).
//
// Shape on disk: `{ leads: { [userId]: { [versionId]: { instances, by, at } } } }`.
// Instance ids are the same as `event.instanceIds` (src/config/gameVersions/),
// and versions stay strictly apart: an id from another version is dropped on
// write, like any id nobody knows. An empty list removes the version entry, so
// "no entry" always means "does not lead there" — being orga or admin does not
// make anybody a leader.
//
// These flags are no notes about a person (vermerke): raiders may see that
// somebody leads, the person sets their own flags and sees who set them.

const { instance, rulesFor } = require("../../config/gameVersions");
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const LEADS_FILE = settingsPath("leader-flags.json");
const store = createJsonStore({
    file: LEADS_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && typeof data.leads === "object" && !Array.isArray(data.leads) ? data.leads : {}),
});

/** The instance ids of `versionId` among `ids`, unique, in the version's own order. */
function validInstances(versionId, ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "")).filter((id) => instance(versionId, id)));
    return rulesFor(versionId).instances.map((i) => i.id).filter((id) => wanted.has(id));
}

/** One account's flags: `{ [versionId]: { instances, by, at } }` (a copy). */
function leadsOf(userId) {
    const entry = store.read()[String(userId || "")];
    return entry ? JSON.parse(JSON.stringify(entry)) : {};
}

/** Every account's flags, for a list that marks many people at once. */
function allLeads() {
    return store.read();
}

/**
 * Set the instances `userId` leads in `versionId`, replacing what was there.
 * Unknown instances are dropped, an empty list removes the entry. Returns the
 * stored entry (null after a removal) or throws for an unknown version or user.
 */
function setLeads(userId, versionId, instances, { by = "" } = {}) {
    const uid = String(userId || "").trim();
    const vid = String(versionId || "").trim();
    if (!uid) throw new Error("userId fehlt");
    if (!vid || !rulesFor(vid)) throw new Error(`Unbekannte Version: ${vid}`);
    const ids = validInstances(vid, instances);
    let result = null;
    store.update((all) => {
        const next = { ...all };
        const mine = { ...(next[uid] || {}) };
        if (ids.length) {
            result = { instances: ids, by: String(by || uid), at: Date.now() };
            mine[vid] = result;
        } else {
            delete mine[vid];
        }
        if (Object.keys(mine).length) next[uid] = mine;
        else delete next[uid];
        return { leads: next };
    });
    return result;
}

/** Drop everything — tests only. */
function reset() {
    store.remove();
}

module.exports = { leadsOf, allLeads, setLeads, validInstances, reset, LEADS_FILE, useFile: store.useFile };
