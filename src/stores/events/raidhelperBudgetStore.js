// How many requests went to raid-helper.xyz in the last 24 hours, and whether
// Raid-Helper itself asked for a pause (utils/raidhelper/budget.js) — per
// Discord server, since every server asks with its own key (#927).
//
// `data/settings/raidhelper-budget.json` = { servers: { [guildId]: { hours:
// { [hourIndex]: count }, blockedUntil, blockedReason } } } — `hourIndex` is
// Math.floor(ms / 1 h), so a day is at most 24 small entries per server. On
// disk rather than in memory because Raid-Helper counts across our restarts: a
// deploy must not hand the bot a fresh 1000 that Raid-Helper never gave it.
//
// A file from before #927 held one flat state; it is read as `legacy` until the
// start migration hands it to the server that owned Raid-Helper (moveLegacy).

const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const EMPTY_STATE = () => ({ hours: {}, blockedUntil: 0, blockedReason: "" });
const EMPTY = () => ({ servers: {} });

const isMap = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function normalizeState(data) {
    if (!isMap(data)) return EMPTY_STATE();
    const hours = {};
    for (const [hour, count] of Object.entries(isMap(data.hours) ? data.hours : {})) {
        const n = Number(count);
        if (/^\d+$/.test(hour) && Number.isFinite(n) && n > 0) hours[hour] = n;
    }
    return {
        hours,
        blockedUntil: Number(data.blockedUntil) || 0,
        blockedReason: String(data.blockedReason || ""),
    };
}

// The flat shape (before #927) has `hours` or a block at the top.
const isFlat = (data) => "hours" in data || "blockedUntil" in data;

function normalize(data) {
    if (!isMap(data)) return EMPTY();
    if (!isMap(data.servers) && isFlat(data)) return { servers: {}, legacy: normalizeState(data) };
    const servers = {};
    for (const [guildId, state] of Object.entries(isMap(data.servers) ? data.servers : {})) {
        servers[guildId] = normalizeState(state);
    }
    const out = { servers };
    if (isMap(data.legacy)) out.legacy = normalizeState(data.legacy);
    return out;
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

const key = (guildId) => String(guildId || "").trim();

/** The stored state of one server, every field present. */
function readBudget(guildId) {
    return store.read().servers[key(guildId)] || EMPTY_STATE();
}

/** Replace the stored state of one server (the caller prunes old hours). */
function writeBudget(guildId, state) {
    const data = store.read();
    store.write({ ...data, servers: { ...data.servers, [key(guildId)]: normalizeState(state) } });
}

/**
 * The state of a file from before #927 goes to `guildId` (the start migration).
 * Idempotent: nothing happens once there is no legacy state; a state the server
 * already has wins. Returns whether it wrote.
 */
function moveLegacy(guildId) {
    const data = store.read();
    if (!data.legacy) return false;
    const servers = { ...data.servers };
    const id = key(guildId);
    if (id && !servers[id]) servers[id] = data.legacy;
    store.write({ servers });
    return true;
}

module.exports = { readBudget, writeBudget, moveLegacy, useFile };
