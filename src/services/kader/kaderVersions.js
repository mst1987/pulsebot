// The game versions the Kaderplaner holds Kader for, seen from outside it: the
// menu's content switch (services/versions/contentVersions.js) offers a version
// only when something is stored for it, and a Kader stands only under its own
// version (#741). Without this door a server whose only Forever data is the
// planner could never switch to Forever and so lost its Kader. Only version
// ids leave through here - no Kader, no player, nothing logged.
const kaderStore = require("../../stores/kaderStore");
const { kaderVersion } = require("./kaderModel");

/** The version ids of every Kader of every server, once each. */
function kaderVersionIds() {
    const out = new Set();
    let keys;
    try {
        keys = kaderStore.plannerGuildKeys();
    } catch {
        return [];
    }
    for (const guildId of keys) {
        for (const k of (kaderStore.readPlanner(guildId) || {}).kaders || []) out.add(kaderVersion(k.versionId));
    }
    return [...out];
}

module.exports = { kaderVersionIds };
