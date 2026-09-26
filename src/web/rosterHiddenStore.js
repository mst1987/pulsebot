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

const { characterKeyOf } = require("../utils/loot/lootImport");
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const HIDDEN_FILE = settingsPath("roster-hidden.json");
const store = createJsonStore({
    file: HIDDEN_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && typeof data.hidden === "object" && !Array.isArray(data.hidden) ? data.hidden : {}),
});

function readAll() {
    return store.read();
}

function writeAll(hidden) {
    store.write({ hidden });
}

/** All entries as `{ [characterKey]: { character, reason, at, by } }`. */
function listHidden() {
    return readAll();
}

/** Whether this character is hidden right now. */
function isHidden(character) {
    const key = characterKeyOf(character);
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
    const key = characterKeyOf(character);
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
    const key = characterKeyOf(character);
    if (!key) return false;
    const all = readAll();
    if (!all[key]) return false;
    delete all[key];
    writeAll(all);
    return true;
}

/** Drop everything — tests only. */
function reset() {
    store.remove();
}

module.exports = { listHidden, isHidden, hiddenKeys, hide, unhide, reset, characterKey: characterKeyOf, HIDDEN_FILE, useFile: store.useFile };
