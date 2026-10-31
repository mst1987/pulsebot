const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

// The loot data of a setup proposal (#1037): what "Loot-Daten laden" gathered for a
// raid group, so the proposal itself reads it from here and never calls an API.
// One snapshot per group, keyed by the signup event (the first raid of the group).
// `wants` is the shape of utils/setup/lootWants.js, `items` the names and icons of
// the items in it, `counts` what the status line says ("Gear für 31 von 50").
const store = createJsonStore({ file: settingsPath("setup-loot.json"), defaults: { groups: {} } });

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function groupsOf(data) {
    return data && data.groups && typeof data.groups === "object" ? data.groups : {};
}

/** The stored snapshot of a raid group, or null. */
function getSetupLoot(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    return groupsOf(store.read())[id] || null;
}

/** Store (replace) the snapshot of a raid group; drops snapshots older than 30 days. */
function saveSetupLoot(eventId, snapshot = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const now = Date.now();
    const groups = { ...groupsOf(store.read()) };
    for (const [key, g] of Object.entries(groups)) if (!g || now - Number(g.at || 0) > MAX_AGE_MS) delete groups[key];
    const counts = snapshot.counts || {};
    const saved = {
        eventId: id,
        versionId: String(snapshot.versionId || ""),
        instanceIds: (Array.isArray(snapshot.instanceIds) ? snapshot.instanceIds.map(String) : []).sort(),
        at: now,
        wants: snapshot.wants && typeof snapshot.wants === "object" ? snapshot.wants : {},
        items: snapshot.items && typeof snapshot.items === "object" ? snapshot.items : {},
        counts: {
            signups: Number(counts.signups || 0),
            gear: Number(counts.gear || 0),
            softres: Number(counts.softres || 0),
            bis: Number(counts.bis || 0),
            spec: Number(counts.spec || 0),
        },
    };
    groups[id] = saved;
    store.write({ groups });
    return saved;
}

module.exports = { getSetupLoot, saveSetupLoot, useFile: store.useFile };
