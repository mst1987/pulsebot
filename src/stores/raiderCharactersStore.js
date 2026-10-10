const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const characterStore = require("./characterStore");
const rosterStore = require("./rosterStore");
const raiderProfileStore = require("./raiderProfileStore");
const { characterKeyOf, nameKeyOf } = require("../utils/loot/lootImport");
const { mainVersionFor } = require("../services/events/mainVersion");

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
//
// One roster per category and version (#739): a reader naming a version
// (`{ versionId }`) reads that version's roster; without one, the category's
// rosters are merged - the roster of the version it plays now first, the
// others (a closed one of the old version) fill in who has no character there,
// so a raider copied into the new roster without a character keeps his old
// one for the old raids. Writes go to the roster of the version the category
// plays now.
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

/** The version a category plays now. */
function currentVersionOf(categoryId) {
    return mainVersionFor({ categoryId });
}

/**
 * The assignments of several rosters of one category, merged: the first
 * roster's character of a raider wins, the later ones fill in (#739).
 */
function mergedAssignments(rosters) {
    const out = {};
    for (const roster of rosters) {
        for (const [userId, name] of Object.entries(rosterAssignments(roster))) if (!(userId in out)) out[userId] = name;
    }
    return out;
}

/** A category's rosters, the one of the version it plays now first (#739). */
function categoryRosters(categoryId) {
    const all = rosterStore.rostersForCategory(categoryId);
    const now = currentVersionOf(categoryId);
    return [...all.filter((r) => r.versionId === now), ...all.filter((r) => r.versionId !== now)];
}

/**
 * Raider (userId) -> character name assigned for one category. Never undefined.
 * `versionId` (#739): only that version's roster; none = every roster of the
 * category merged (the current version's first).
 */
function getCategoryAssignments(categoryId, { versionId = "" } = {}) {
    const key = String(categoryId || "").trim();
    if (!key) return {};
    const rosters = categoryRosters(key);
    if (rosters.length) {
        if (!versionId) return mergedAssignments(rosters);
        const own = rosters.find((r) => r.versionId === versionId);
        return own ? rosterAssignments(own) : {};
    }
    const raw = store.read()[key];
    return isMap(raw) ? raw : {};
}

/**
 * Every category's assignments at once: { [categoryId]: { [userId]: character } }.
 * The roster overview needs all of them to answer "welche Chars gehören zu
 * welchem Raid" without one read per configured category. The file's
 * categories in their order (one with a roster read from the roster), then the
 * rosters' categories the file does not have. A roster without any character
 * is left out, like a category whose last assignment was removed. A category
 * with rosters of several versions merges them (getCategoryAssignments).
 */
function listAllAssignments() {
    const rosters = new Map();
    for (const r of rosterStore.listRosters("")) {
        if (r.categoryId && !rosters.has(r.categoryId)) rosters.set(r.categoryId, categoryRosters(r.categoryId));
    }
    const out = {};
    const addRoster = (categoryId) => {
        const map = mergedAssignments(rosters.get(categoryId));
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
 * The roster is the one of the version the category plays now (#739); when
 * that one is missing or closed while the category has rosters of other
 * versions, nothing is written and the merged map as it stands comes back.
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
    const rosters = categoryRosters(key);
    if (rosters.length) {
        const roster = rosters.find((r) => r.versionId === currentVersionOf(key) && !rosterStore.isClosed(r));
        if (!roster) return getCategoryAssignments(key);
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
function resolveAssignmentProfiles(categoryId, { versionId = "" } = {}) {
    const raw = getCategoryAssignments(categoryId, { versionId });
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
