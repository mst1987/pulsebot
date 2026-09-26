const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { splitPlayer, characterKeyOf } = require("../utils/lootImport");

// Class + spec per character, kept next to the other editable settings. This is a
// CACHE: the facts come from the loot export or from a Warcraft-Logs report, and
// resolving them costs API calls, so once known they are stored here and the
// history pages read them for free.
//
// Keyed case-insensitively by the character name without its realm (see
// characterKeyOf in utils/lootImport), so "Keslight", "keslight" and "Keslight-Thunderstrike" are
// one character.
const CHARACTERS_FILE = settingsPath("characters.json");

// Where a class/spec came from — shown in the UI so a wrong entry can be traced.
const SOURCES = ["export", "report", "wcl", "manual"];

const store = createJsonStore({
    file: CHARACTERS_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.characters) ? data.characters : []),
});

function readAll() {
    return store.read();
}

function writeAll(characters) {
    store.write({ characters });
}

/** All known characters, alphabetically. */
function listCharacters() {
    return readAll().slice().sort((a, b) => String(a.character || "").localeCompare(String(b.character || "")));
}

/** What is known about one character (by name or key), or null. */
function getCharacter(character) {
    const key = characterKeyOf(character);
    if (!key) return null;
    return readAll().find((c) => c.key === key) || null;
}

/** Lookup map key -> record, for annotating a whole list in one read. */
function characterMap() {
    const map = {};
    for (const c of readAll()) map[c.key] = c;
    return map;
}

/**
 * Remember a character's class/spec. Only fills in what is actually known: a call
 * without a spec never wipes a spec that is already stored, and a weaker source
 * never overwrites a stronger one (manual > wcl/report > export). Returns the
 * saved record, or null for a blank name / an update that changed nothing.
 */
function saveCharacter(character, data = {}) {
    const key = characterKeyOf(character);
    if (!key) return null;
    const name = splitPlayer(character).character;
    const className = String(data.className || "").trim();
    const spec = String(data.spec || "").trim();
    const source = SOURCES.includes(data.source) ? data.source : "export";
    if (!className && !spec) return null;

    const all = readAll();
    const existing = all.find((c) => c.key === key);
    if (!existing) {
        const saved = {
            key, character: name, className, spec, source,
            reportId: String(data.reportId || "").trim(),
            updatedAt: Date.now(),
        };
        all.push(saved);
        writeAll(all);
        return saved;
    }
    // A manual entry is the admin's word — only another manual edit may change it.
    if (existing.source === "manual" && source !== "manual") return existing;
    const next = { ...existing };
    if (className) next.className = className;
    if (spec) next.spec = spec;
    if (data.reportId) next.reportId = String(data.reportId).trim();
    const changed = next.className !== existing.className
        || next.spec !== existing.spec
        || next.reportId !== existing.reportId;
    if (!changed) return existing;
    next.source = source;
    next.updatedAt = Date.now();
    Object.assign(existing, next);
    writeAll(all);
    return existing;
}

/** Drop what is known about a character. Returns true if a record was removed. */
function deleteCharacter(character) {
    const key = characterKeyOf(character);
    if (!key) return false;
    const all = readAll();
    const next = all.filter((c) => c.key !== key);
    if (next.length === all.length) return false;
    writeAll(next);
    return true;
}

module.exports = {
    listCharacters, getCharacter, characterMap, saveCharacter, deleteCharacter,
    CHARACTERS_FILE, SOURCES, useFile: store.useFile,
};
