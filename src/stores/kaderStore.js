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
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { normalizePlanner } = require("../services/kader/kaderModel");
const { migrateLegacyPlanner, migrationSummary } = require("../services/kader/kaderMigration");

const store = createJsonStore({
    file: settingsPath("kader.json"),
    defaults: () => ({}),
    normalize: (data) => (data && data.guilds && typeof data.guilds === "object" && !Array.isArray(data.guilds) ? data.guilds : {}),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const keyOf = (guildId) => String(guildId || "").trim() || "_";

/** The planner of one server, normalised (an empty one when nothing is stored). */
function readPlanner(guildId) {
    return normalizePlanner(store.read()[keyOf(guildId)]);
}

/** Stores the planner of one server (normalised again on the way in). */
function writePlanner(guildId, planner) {
    const guilds = store.read();
    guilds[keyOf(guildId)] = normalizePlanner(planner);
    store.write({ guilds });
    return guilds[keyOf(guildId)];
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
    if (done.length) store.write({ guilds });
    return done;
}

module.exports = { readPlanner, writePlanner, migrateLegacy, useFile };
