const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const characterStore = require("./characterStore");
const rosterStore = require("./rosterStore");
const raiderProfileStore = require("./raiderProfileStore");
const { characterKeyOf, nameKeyOf } = require("../utils/loot/lootImport");

// Manual, per-raid-category mapping of a raider (Discord user id) to the WoW
// character they play there — raiders often play a different character on
// different raid days/types (same Discord category = same recurring raid
// series, see categoryRoles in settingsStore.js), so this cannot be inferred
// reliably from past signups alone. Used to enrich the "missing" list on the
// raid-event detail page with the character (and class/spec) that is
// actually expected, even when the raider hasn't signed up recently.
//
// A facade since the rosters (#653, rosterStore.js): a category that has a
// roster is read from it - every member with a character, his first one, as
// the name it was assigned under - and setCategoryAssignments writes into that
// roster. Only categories without a roster still live in raider-characters.json
// (the file stays as it was after the migration; nothing reads it for a
// category with a roster). The API and its answers are the same either way.
const RAIDER_CHARACTERS_FILE = settingsPath("raider-characters.json");

const store = createJsonStore({
    file: RAIDER_CHARACTERS_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && typeof data === "object" && !Array.isArray(data) ? data : {}),
});

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** raider-characters.json as stored, rosters left aside: { [categoryId]: { [userId]: name } } (the migration's input). */
function readLegacyAssignments() {
    const out = {};
    for (const [categoryId, map] of Object.entries(store.read())) {
        if (isMap(map)) out[categoryId] = { ...map };
    }
    return out;
}

/**
 * The name a member's character key is shown as: the name it was assigned
 * under, else the raider's profile character, else what the character cache
 * knows, else the name part of the key.
 */
function nameOfKey(userId, key, member) {
    const stored = member.charNames && member.charNames[key];
    if (stored) return stored;
    const own = raiderProfileStore.findCharacter(raiderProfileStore.getProfile(userId), key);
    if (own && own.name) return own.name;
    const cached = characterStore.getCharacter(key);
    return (cached && cached.character) || nameKeyOf(key);
}

/** A roster's members as { [userId]: name }: everyone with a character, his first one. */
function rosterAssignments(roster) {
    const out = {};
    for (const [userId, member] of Object.entries(roster.members || {})) {
        const key = member.chars && member.chars[0];
        if (key) out[userId] = nameOfKey(userId, key, member);
    }
    return out;
}

/** Raider (userId) -> character name assigned for one category. Never undefined. */
function getCategoryAssignments(categoryId) {
    const key = String(categoryId || "").trim();
    if (!key) return {};
    const roster = rosterStore.rosterForCategory(key);
    if (roster) return rosterAssignments(roster);
    const raw = store.read()[key];
    return isMap(raw) ? raw : {};
}

/**
 * Every category's assignments at once: { [categoryId]: { [userId]: character } }.
 * The roster overview needs all of them to answer "welche Chars gehören zu
 * welchem Raid" without one read per configured category. The file's
 * categories in their order (one with a roster read from the roster), then the
 * rosters' categories the file does not have. A roster without any character
 * is left out, like a category whose last assignment was removed.
 */
function listAllAssignments() {
    const rosters = new Map(rosterStore.listRosters("").filter((r) => r.categoryId).map((r) => [r.categoryId, r]));
    const out = {};
    const addRoster = (categoryId) => {
        const map = rosterAssignments(rosters.get(categoryId));
        if (Object.keys(map).length) out[categoryId] = map;
    };
    for (const [categoryId, map] of Object.entries(readLegacyAssignments())) {
        if (rosters.has(categoryId)) addRoster(categoryId);
        else out[categoryId] = map;
    }
    for (const categoryId of rosters.keys()) {
        if (!(categoryId in out)) addRoster(categoryId);
    }
    return out;
}

/**
 * Replace the whole raider->character map of one category. Entries with a
 * blank character name are dropped (that's how an assignment is removed).
 * Returns the normalized, saved map.
 *
 * With a roster: every raider in the map gets the character as his first one
 * (a raider not yet in the roster joins it as "core"); a member left out loses
 * his characters but stays in the roster with his status (rosterStore
 * setFirstChars). Reading the category back gives exactly the returned map.
 */
function setCategoryAssignments(categoryId, map, { actor = "" } = {}) {
    const key = String(categoryId || "").trim();
    if (!key) return {};
    const clean = {};
    for (const [userId, characterName] of Object.entries(map || {})) {
        const uid = String(userId || "").trim();
        const name = String(characterName || "").trim();
        if (uid && name) clean[uid] = name;
    }
    const roster = rosterStore.rosterForCategory(key);
    if (roster) {
        const firsts = {};
        for (const [uid, name] of Object.entries(clean)) firsts[uid] = { key: characterKeyOf(name, roster.versionId), name };
        rosterStore.setFirstChars(roster.id, firsts, { actor });
        return clean;
    }
    const all = store.read();
    if (Object.keys(clean).length) {
        all[key] = clean;
    } else {
        delete all[key];
    }
    store.write(all);
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

/**
 * The characters one Discord account plays, across every category:
 * `[{ character, categoryIds }]`, one entry per character (case-insensitive),
 * in the order they were first found. The bot's "/loot ich" and "/anwesenheit"
 * start from here — the assignment is the only link from a Discord user to a
 * WoW character the bot trusts.
 */
function charactersForUser(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return [];
    const byKey = new Map();
    for (const [categoryId, map] of Object.entries(listAllAssignments())) {
        const name = String(map[uid] || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, { character: name, categoryIds: [] });
        const entry = byKey.get(key);
        if (!entry.categoryIds.includes(categoryId)) entry.categoryIds.push(categoryId);
    }
    return [...byKey.values()];
}

module.exports = {
    getCategoryAssignments, listAllAssignments, setCategoryAssignments, resolveAssignmentProfiles, charactersForUser,
    readLegacyAssignments, RAIDER_CHARACTERS_FILE, useFile: store.useFile,
};
