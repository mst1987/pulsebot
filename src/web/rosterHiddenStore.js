// Which characters the roster does not list any more.
//
// The roster is built from loot imports and log evaluations, so it keeps
// everyone who ever raided: the raider who left in April, the alt somebody
// brought once, the trial that never came back. They are not wrong to be in the
// data — the loot history needs them — but a raid lead looking up who to invite
// should not scroll past them, and "40 % Anwesenheit" over a guild half of whom
// left says nothing about the half that is still here.
//
// Like the loot council's exclude list (councilStore.js) this is an explicit
// decision, not a rule such as "nobody who has not raided in 60 days": the
// difference between "gone" and "was ill" is one only a person knows. Hiding is
// reversible, remembers who did it and when, and touches nothing else — the
// character page, the loot history and every evaluation stay exactly as they
// were, and the roster's own "Ausgeblendet" tab lists them.

const fs = require("fs");
const path = require("path");
const { characterKey: lootCharacterKey, splitPlayer } = require("../utils/lootImport");

/** Keyed like lootStore/councilStore: lower case, without the realm suffix. */
function characterKey(character) {
    return lootCharacterKey(splitPlayer(character).character);
}

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const HIDDEN_FILE = path.join(SETTINGS_DIR, "roster-hidden.json");

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(HIDDEN_FILE, "utf8"));
        return data && typeof data.hidden === "object" && !Array.isArray(data.hidden) ? data.hidden : {};
    } catch {
        return {};
    }
}

function writeAll(hidden) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(HIDDEN_FILE, JSON.stringify({ hidden }, null, 2));
}

/** All entries as `{ [characterKey]: { character, reason, at, by } }`. */
function listHidden() {
    return readAll();
}

/** Whether this character is hidden right now. */
function isHidden(character) {
    const key = characterKey(character);
    return !!(key && readAll()[key]);
}

/** The hidden keys, for filtering a whole roster in one pass. */
function hiddenKeys() {
    return new Set(Object.keys(readAll()));
}

/**
 * Take a character off the roster. Returns the stored entry, null for a blank
 * name. Hiding someone twice refreshes the note instead of failing.
 */
function hide(character, { reason = "", by = "" } = {}) {
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

/** Put them back. True when something was actually removed. */
function unhide(character) {
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
        fs.unlinkSync(HIDDEN_FILE);
    } catch {
        // never existed
    }
}

module.exports = { listHidden, isHidden, hiddenKeys, hide, unhide, reset, characterKey, HIDDEN_FILE };
