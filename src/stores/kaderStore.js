// The Kaderplaner's own data (docs/kaderplaner.md), one planner per Discord
// server: accounts added by hand, the planner's character assignments, the
// rosters and their group setups. The shape and every rule for changing it are
// in services/kader/kaderModel.js; this store only reads and writes it.
//
//   data/settings/kader.json = { guilds: { [guildId]: planner } }
//
// Nothing here is ever written into a raider profile — the planner's view of a
// player wins inside the planner and nowhere else.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { normalizePlanner } = require("../services/kader/kaderModel");

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

module.exports = { readPlanner, writePlanner, useFile };
