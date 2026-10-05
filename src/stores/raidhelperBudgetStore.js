// How many requests went to raid-helper.xyz in the last 24 hours, and whether
// Raid-Helper itself asked for a pause (utils/raidhelper/budget.js).
//
// `data/settings/raidhelper-budget.json` = { hours: { [hourIndex]: count },
// blockedUntil, blockedReason } — `hourIndex` is Math.floor(ms / 1 h), so a
// day is at most 24 small entries. On disk rather than in memory because
// Raid-Helper counts across our restarts: a deploy must not hand the bot a
// fresh 1000 that Raid-Helper never gave it.

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const EMPTY = () => ({ hours: {}, blockedUntil: 0, blockedReason: "" });

function normalize(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY();
    const hours = {};
    for (const [hour, count] of Object.entries(data.hours || {})) {
        const n = Number(count);
        if (/^\d+$/.test(hour) && Number.isFinite(n) && n > 0) hours[hour] = n;
    }
    return {
        hours,
        blockedUntil: Number(data.blockedUntil) || 0,
        blockedReason: String(data.blockedReason || ""),
    };
}

const store = createJsonStore({
    file: settingsPath("raidhelper-budget.json"),
    defaults: EMPTY,
    normalize,
    cache: true,
    space: 0,
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/** The stored state, every field present. */
function readBudget() {
    return store.read();
}

/** Replace the stored state (the caller prunes old hours). */
function writeBudget(state) {
    store.write(normalize(state));
}

module.exports = { readBudget, writeBudget, useFile };
