const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

// The loot data of a setup proposal (#1037): what "Loot-Daten laden" gathered for a
// raid group, so the proposal itself reads it from here and never calls an API.
// One snapshot per group, keyed by the signup event (the first raid of the group).
// `wants` is the shape of utils/setup/lootWants.js, `items` the names and icons of
// the items in it, `gear` the mean item level per raider and character ("Raids gleich
// stark", #1038), `counts` what the status line says ("Gear für 31 von 50").
const store = createJsonStore({ file: settingsPath("setup-loot.json"), defaults: { groups: {} } });

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function groupsOf(data) {
    return data && data.groups && typeof data.groups === "object" ? data.groups : {};
}

const SOURCES = new Set(["softres", "armory", "logs", "all"]);

/**
 * The time of the oldest data in a snapshot: `keptAt` when a raider still holds entries an
 * earlier load fetched (carried over load after load), else `at`. The 30-day limit counts from here.
 */
const oldestOf = (g) => Number(g.keptAt) || Number(g.at || 0);

const tooOld = (g, now) => !g || now - oldestOf(g) > MAX_AGE_MS;

/** The sources a load could not reach (`softres`, `armory`, `logs`, `all`), once each. */
function failedOf(list) {
    return [...new Set((Array.isArray(list) ? list : []).map(String).filter((x) => SOURCES.has(x)))];
}

/** `gear` = `{ [userId]: { [charKey]: meanItemLevel } }` (#1038): only positive numbers stay. */
function gearOf(gear) {
    const out = {};
    if (!gear || typeof gear !== "object") return out;
    for (const [userId, byChar] of Object.entries(gear)) {
        if (!byChar || typeof byChar !== "object") continue;
        for (const [key, lvl] of Object.entries(byChar)) {
            const n = Number(lvl);
            if (Number.isFinite(n) && n > 0) (out[userId] = out[userId] || {})[key] = Math.round(n * 10) / 10;
        }
    }
    return out;
}

/**
 * The stored snapshot of a raid group, or null - also when it is older than 30 days:
 * the limit holds on read, not only when the next save happens to clean up.
 */
function getSetupLoot(eventId, { now = Date.now() } = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const g = groupsOf(store.read())[id];
    return tooOld(g, now) ? null : g;
}

/**
 * A load that reached none of its sources (#1037): the snapshot keeps its data and its
 * `at`, it only learns which sources failed and when. Null without a (fresh) snapshot.
 */
function markSetupLootFailed(eventId, failed, { now = Date.now() } = {}) {
    const id = String(eventId || "").trim();
    const groups = { ...groupsOf(store.read()) };
    if (!id || tooOld(groups[id], now)) return null;
    groups[id] = { ...groups[id], failed: failedOf(failed), failedAt: now, keptAt: oldestOf(groups[id]) };
    store.write({ groups });
    return groups[id];
}

/**
 * Store (replace) the snapshot of a raid group; drops snapshots older than 30 days.
 * `failed`/`keptAt`: the sources this load could not reach and the time of the oldest
 * data a raider kept in their place (0 = nothing kept); the snapshot expires 30 days after it.
 */
function saveSetupLoot(eventId, snapshot = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const now = Date.now();
    const groups = { ...groupsOf(store.read()) };
    for (const [key, g] of Object.entries(groups)) if (tooOld(g, now)) delete groups[key];
    const counts = snapshot.counts || {};
    const saved = {
        eventId: id,
        versionId: String(snapshot.versionId || ""),
        instanceIds: (Array.isArray(snapshot.instanceIds) ? snapshot.instanceIds.map(String) : []).sort(),
        at: now,
        wants: snapshot.wants && typeof snapshot.wants === "object" ? snapshot.wants : {},
        items: snapshot.items && typeof snapshot.items === "object" ? snapshot.items : {},
        gear: gearOf(snapshot.gear),
        counts: {
            signups: Number(counts.signups || 0),
            gear: Number(counts.gear || 0),
            softres: Number(counts.softres || 0),
            bis: Number(counts.bis || 0),
            spec: Number(counts.spec || 0),
        },
        failed: failedOf(snapshot.failed),
        failedAt: failedOf(snapshot.failed).length ? now : 0,
        keptAt: Number(snapshot.keptAt) || 0,
    };
    groups[id] = saved;
    store.write({ groups });
    return saved;
}

module.exports = { getSetupLoot, saveSetupLoot, markSetupLootFailed, MAX_AGE_MS, useFile: store.useFile };
