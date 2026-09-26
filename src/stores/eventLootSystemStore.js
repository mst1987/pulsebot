const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { normalizeLootSystem, resolveLootSystem } = require("../services/loot/lootSystem");
const { getConfig } = require("./settingsStore");
const { getEventSoftres } = require("./eventSoftresStore");

// The loot system of one raid where it differs from its category's
// (src/services/loot/lootSystem.js), plus the "Softres zusätzlich" switch. Keyed by event
// id, so it works for an own event and a Raid-Helper event alike — the latter
// has no record of ours to put a field on.
//
// data/settings/event-loot-system.json:
//   { events: { [eventId]: { system: "" | "softres" | …, softres: boolean, at, by, byName } } }
//
// An entry that says nothing (no system of its own, no extra softres) is
// removed, so "wie die Kategorie" is the absence of an entry.

const store = createJsonStore({
    file: settingsPath("event-loot-system.json"),
    defaults: () => ({}),
    normalize: (data) => (data && typeof data.events === "object" && !Array.isArray(data.events) ? data.events : {}),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

function readAll() {
    return store.read();
}

function writeAll(events) {
    store.write({ events });
}

/** The override of one raid, or null when it follows its category. */
function getEventLootSystem(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    return readAll()[id] || null;
}

/**
 * Set (or clear) one raid's override. `system` "" = like the category;
 * `softres` true = offer the softres list in addition. Returns the stored
 * entry, or null when nothing is left to store.
 */
function setEventLootSystem(eventId, { system = "", softres = false, by = "", byName = "" } = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const all = readAll();
    const entry = { system: normalizeLootSystem(system), softres: softres === true };
    if (!entry.system && !entry.softres) {
        delete all[id];
        writeAll(all);
        return null;
    }
    all[id] = { ...entry, at: Date.now(), by: String(by || ""), byName: String(byName || "") };
    writeAll(all);
    return all[id];
}

/** Forget a raid's override (the event was deleted). True when one was removed. */
function deleteEventLootSystem(eventId) {
    const id = String(eventId || "").trim();
    const all = readAll();
    if (!id || !all[id]) return false;
    delete all[id];
    writeAll(all);
    return true;
}

/**
 * The resolved loot system of one raid (lootSystem.resolveLootSystem) from the
 * stored config, this raid's override and its softres list — the one call the
 * readers (raid detail, dashboard) make.
 */
function lootSystemOf(eventId, categoryId) {
    return resolveLootSystem({
        config: getConfig(),
        categoryId,
        override: getEventLootSystem(eventId),
        softresList: getEventSoftres(eventId),
    });
}

module.exports = { useFile, getEventLootSystem, setEventLootSystem, deleteEventLootSystem, lootSystemOf };
