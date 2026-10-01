// The Kaderplaner's own data (docs/kaderplaner.md), one planner per Discord
// server: accounts known by hand, the planner's character data per account and
// the Kader with their players (state, interview, votes, comments, decision),
// questions and example setups. The shape and every rule for changing it are in
// services/kader/; this store only reads and writes it.
//
//   data/settings/kader.json = { guilds: { [guildId]: planner } }
//
// Nothing here is ever written into a raider profile, and nothing here leaves
// the Kaderplaner: only its routes and its web modules read this store
// (test/stores/kaderStore.test.js keeps the list).
//
// `liveState` is what the page polls every few seconds (GET /api/kader/live):
// the revisions and the activity log of one Kader. It reads the file only when
// it changed (a stat per poll), never the whole planner per poll.
const fs = require("fs");
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { normalizePlanner } = require("../services/kader/kaderModel");
const { migrateLegacyPlanner, migrationSummary } = require("../services/kader/kaderMigration");

const store = createJsonStore({
    file: settingsPath("kader.json"),
    defaults: () => ({}),
    normalize: (data) => (data && data.guilds && typeof data.guilds === "object" && !Array.isArray(data.guilds) ? data.guilds : {}),
});

// { key, guilds: Map<guildKey, { sharedRev, kaders: Map<kaderId, { rev, activity }> }> } — the revisions per
// server, valid while the file has the same mtime/size/inode and nothing was written through this module
let live = null;

/** Tests point the store at a file of their own; null = the default again. */
function useFile(file) {
    live = null;
    store.useFile(file);
}

const keyOf = (guildId) => String(guildId || "").trim() || "_";

/** The planner of one server, normalised (an empty one when nothing is stored). */
function readPlanner(guildId) {
    return normalizePlanner(store.read()[keyOf(guildId)]);
}

/** Stores the planner of one server (normalised again on the way in). */
function writePlanner(guildId, planner) {
    const guilds = store.read();
    guilds[keyOf(guildId)] = normalizePlanner(planner);
    live = null;
    store.write({ guilds });
    return guilds[keyOf(guildId)];
}

function fileKey() {
    try {
        const st = fs.statSync(store.file);
        return `${store.file}:${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch {
        return `${store.file}:none`;
    }
}

/**
 * The live state of one Kader: `{ found, rev, sharedRev, activity }` —
 * revision 0 and no log for a Kader stored before they existed, `found: false`
 * for a Kader that is not (or no longer) there.
 */
function liveState(guildId, kaderId) {
    const key = fileKey();
    if (!live || live.key !== key) live = { key, guilds: new Map() };
    const g = keyOf(guildId);
    if (!live.guilds.has(g)) {
        const planner = readPlanner(guildId);
        live.guilds.set(g, {
            sharedRev: planner.sharedRev || 0,
            kaders: new Map(planner.kaders.map((k) => [k.id, { rev: k.rev || 0, activity: k.activity || [] }])),
        });
    }
    const server = live.guilds.get(g);
    const kader = server.kaders.get(String(kaderId || ""));
    return kader
        ? { found: true, rev: kader.rev, sharedRev: server.sharedRev, activity: kader.activity }
        : { found: false, rev: 0, sharedRev: server.sharedRev, activity: [] };
}

/**
 * The one-time upgrade of #566 planners (settingsMigration.js): every server
 * whose planner still has rosters gets Kader. `charOfFor(rawPlanner)` hands the
 * migration a character lookup for that server. Idempotent — a migrated planner
 * is left alone. Returns one summary per migrated server.
 */
function migrateLegacy({ now, charOfFor, roleOf } = {}) {
    const guilds = store.read();
    const done = [];
    for (const [guildId, raw] of Object.entries(guilds)) {
        const migrated = migrateLegacyPlanner(raw, { now, charOf: charOfFor(raw), ...(roleOf ? { roleOf } : {}) });
        if (!migrated) continue;
        guilds[guildId] = normalizePlanner(migrated);
        done.push({ guildId, ...migrationSummary(guilds[guildId]) });
    }
    if (done.length) {
        live = null;
        store.write({ guilds });
    }
    return done;
}

module.exports = { readPlanner, writePlanner, liveState, migrateLegacy, useFile };
