const fs = require("fs");
const path = require("path");
const { normalizeLootSystem, resolveLootSystem } = require("./lootSystem");

// The loot system of one raid where it differs from its category's
// (src/web/lootSystem.js), plus the "Softres zusätzlich" switch. Keyed by event
// id, so it works for an own event and a Raid-Helper event alike — the latter
// has no record of ours to put a field on.
//
// data/settings/event-loot-system.json:
//   { events: { [eventId]: { system: "" | "softres" | …, softres: boolean, at, by, byName } } }
//
// An entry that says nothing (no system of its own, no extra softres) is
// removed, so "wie die Kategorie" is the absence of an entry.

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const DEFAULT_FILE = path.join(SETTINGS_DIR, "event-loot-system.json");
let storeFile = DEFAULT_FILE;

/** Tests only: read and write another file. */
function useFile(file) {
    storeFile = file || DEFAULT_FILE;
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(storeFile, "utf8"));
        return data && typeof data.events === "object" && !Array.isArray(data.events) ? data.events : {};
    } catch {
        return {};
    }
}

function writeAll(events) {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify({ events }, null, 2));
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
    const { getConfig } = require("./settingsStore");
    const { getEventSoftres } = require("./eventSoftresStore");
    return resolveLootSystem({
        config: getConfig(),
        categoryId,
        override: getEventLootSystem(eventId),
        softresList: getEventSoftres(eventId),
    });
}

module.exports = { useFile, getEventLootSystem, setEventLootSystem, deleteEventLootSystem, lootSystemOf };
