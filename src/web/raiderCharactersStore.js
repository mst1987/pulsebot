const fs = require("fs");
const path = require("path");
const characterStore = require("./characterStore");

// Manual, per-raid-category mapping of a raider (Discord user id) to the WoW
// character they play there — raiders often play a different character on
// different raid days/types (same Discord category = same recurring raid
// series, see categoryRoles in settingsStore.js), so this cannot be inferred
// reliably from past signups alone. Used to enrich the "missing" list on the
// raid-event detail page with the character (and class/spec) that is
// actually expected, even when the raider hasn't signed up recently.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const RAIDER_CHARACTERS_FILE = path.join(SETTINGS_DIR, "raider-characters.json");

function ensureDir() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(RAIDER_CHARACTERS_FILE, "utf8"));
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

function writeAll(byCategory) {
    ensureDir();
    fs.writeFileSync(RAIDER_CHARACTERS_FILE, JSON.stringify(byCategory, null, 2));
}

/** Raider (userId) -> character name assigned for one category. Never undefined. */
function getCategoryAssignments(categoryId) {
    const key = String(categoryId || "").trim();
    if (!key) return {};
    const raw = readAll()[key];
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Every category's assignments at once: { [categoryId]: { [userId]: character } }.
 * The roster overview needs all of them to answer "welche Chars gehören zu
 * welchem Raid" without one read per configured category.
 */
function listAllAssignments() {
    const all = readAll();
    const out = {};
    for (const [categoryId, map] of Object.entries(all)) {
        if (!map || typeof map !== "object" || Array.isArray(map)) continue;
        out[categoryId] = { ...map };
    }
    return out;
}

/**
 * Replace the whole raider->character map of one category. Entries with a
 * blank character name are dropped (that's how an assignment is removed).
 * Returns the normalized, saved map.
 */
function setCategoryAssignments(categoryId, map) {
    const key = String(categoryId || "").trim();
    if (!key) return {};
    const clean = {};
    for (const [userId, characterName] of Object.entries(map || {})) {
        const uid = String(userId || "").trim();
        const name = String(characterName || "").trim();
        if (uid && name) clean[uid] = name;
    }
    const all = readAll();
    if (Object.keys(clean).length) {
        all[key] = clean;
    } else {
        delete all[key];
    }
    writeAll(all);
    return clean;
}

/**
 * Resolve one category's raw userId->characterName assignments into profile
 * objects ready for utils/attendance.js's withCharacterAssignments(): the
 * character name plus its class/spec, when known (see characterStore.js).
 * @returns {Object<string, {character:string, className?:string, spec?:string}>}
 */
function resolveAssignmentProfiles(categoryId) {
    const raw = getCategoryAssignments(categoryId);
    const profiles = {};
    for (const [userId, characterName] of Object.entries(raw)) {
        const rec = characterStore.getCharacter(characterName);
        profiles[userId] = { character: characterName, className: rec && rec.className, spec: rec && rec.spec };
    }
    return profiles;
}

module.exports = {
    getCategoryAssignments, listAllAssignments, setCategoryAssignments, resolveAssignmentProfiles,
    RAIDER_CHARACTERS_FILE,
};
