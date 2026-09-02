// Which raiders the loot council does not plan with any more.
//
// A roster built from loot and log history keeps everyone who ever raided —
// including the raider who left the guild in April and the alt somebody brought
// once. They are not wrong to be *in* the data, but a council planning tonight's
// drops should not have to scroll past them, and least of all should they win
// the "hat am längsten nichts bekommen" comparison by virtue of not raiding at
// all. Their drought grows forever, so without this they end up on top of the
// list they have no business being on.
//
// Deliberately an explicit list rather than an automatic rule ("nobody who has
// not raided in 60 days"): the difference between "gone" and "was ill for two
// months" is one only a person knows, and guessing it wrong drops a raider who
// is coming back.
//
// Excluding is reversible and remembers why and when, so a council in three
// months can tell a deliberate decision from an accident.

const fs = require("fs");
const path = require("path");
const { characterKey } = require("../utils/lootImport");

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const EXCLUDED_FILE = path.join(SETTINGS_DIR, "council-excluded.json");

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(EXCLUDED_FILE, "utf8"));
        return data && typeof data.excluded === "object" && !Array.isArray(data.excluded) ? data.excluded : {};
    } catch {
        return {};
    }
}

function writeAll(excluded) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(EXCLUDED_FILE, JSON.stringify({ excluded }, null, 2));
}

/**
 * The excluded characters as `{ [characterKey]: { character, reason, at, by } }`.
 * Keyed like lootStore/characterStore, so "Devihra-Thunderstrike" and "devihra"
 * are the same raider.
 */
function listExcluded() {
    return readAll();
}

/** Whether this character is currently excluded. */
function isExcluded(character) {
    const key = characterKey(character);
    return !!(key && readAll()[key]);
}

/** The set of excluded keys, for filtering a whole roster in one pass. */
function excludedKeys() {
    return new Set(Object.keys(readAll()));
}

/**
 * Stop planning with a character. Returns the stored entry, or null for a blank
 * name. Re-excluding someone refreshes the note rather than erroring.
 */
function exclude(character, { reason = "", by = "" } = {}) {
    const key = characterKey(character);
    if (!key) return null;
    const all = readAll();
    all[key] = {
        character: String(character || "").trim(),
        reason: String(reason || "").trim(),
        at: Date.now(),
        by: String(by || "").trim(),
    };
    writeAll(all);
    return all[key];
}

/** Plan with them again. Returns true when something was actually removed. */
function include(character) {
    const key = characterKey(character);
    if (!key) return false;
    const all = readAll();
    if (!all[key]) return false;
    delete all[key];
    writeAll(all);
    return true;
}

/** Drop everything — tests only. */
function reset() {
    try {
        fs.unlinkSync(EXCLUDED_FILE);
    } catch {
        // never existed
    }
}

module.exports = { listExcluded, isExcluded, excludedKeys, exclude, include, reset, EXCLUDED_FILE };
