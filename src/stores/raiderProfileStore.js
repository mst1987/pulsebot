// The raider's own profile ("Mein Profil", #255): which characters they play,
// which specs on each with how far the gear is, whether each character steps in
// as off-tank or healer, when they can raid, which raids they like, whom they
// would like to raid with (and, switched on deliberately, whom not), and a note
// for the orga.
//
// Keyed by Discord user id — the account is the raider, the characters are
// theirs to add. There is no confirmation step: a raider claims a character by
// adding it. A character two accounts claim is not refused but reported
// (`characterClaims()`), because only the orga can tell which of the two is right.
//
// raiderCharactersStore.js stays what it is — the orga's assignment of one
// character per raid category. The profile only suggests from it.
//
// Every character belongs to one game version (#543, `versionId`): a raider has
// TBC and WoW Forever characters side by side, and a Forever character carries
// a last name. The key of a TBC character is its lower-case name as before; any
// other version's key carries the version ("forever~devi res",
// utils/loot/lootImport.js characterKeyOf), so "Devi Res", "Devi Rew" and a TBC
// "Devi" are three characters. A character stored before versions is TBC
// (`LEGACY_VERSION`) — migrateCharacterVersions() writes that down once at start.
//
// Stored under data/settings/raider-profiles.json like the other stores.

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { splitPlayer, characterKeyOf, nameKeyOf } = require("../utils/loot/lootImport");
const { CLASSES, buildClasses } = require("../config/gameVersions/classes");
const { instanceById, rulesFor, LEGACY_VERSION } = require("../config/gameVersions");
const { validateCharacterName, NAME_MAX } = require("../utils/signup/characterNames");
const { isSnowflake } = require("../utils/ids");

const PROFILES_FILE = settingsPath("raider-profiles.json");

// Gear per spec: nothing yet, good enough to be carried, raid ready.
const GEAR_LEVELS = ["none", "usable", "ready"];
const WEEKDAYS = ["mo", "di", "mi", "do", "fr", "sa", "so"];
// Where a character came from — shown as a small badge, never a permission.
const CHARACTER_SOURCES = ["log", "armory", "manual"];

// per game version (countInVersion): TBC and Forever characters each have their own 12
const MAX_CHARACTERS = 12;
const MAX_WISHES = 10;
const MAX_AVOID = 10;
const MAX_NOTE = 500;
// Forever's "Vorname Nachname": 12 + 1 + 12 (utils/signup/characterNames.js).
const MAX_NAME = NAME_MAX;

const SPEC_BY_KEY = new Map();
// What a class can step in as at all — a mage never tanks nor heals, whatever a switch says.
const CLASS_CAN = new Map();
for (const c of buildClasses(CLASSES)) {
    for (const s of c.specs) SPEC_BY_KEY.set(s.key, s);
    CLASS_CAN.set(c.id, { canOfftank: c.specs.some((s) => s.canTank), canHeal: c.specs.some((s) => s.canHeal) });
}
const CLASS_IDS = CLASSES.map((c) => c.id);

/** "mage", "MAGE", "Mage" -> "Mage"; "" for anything that is not a class. */
function normalizeClass(raw) {
    const clean = String(raw || "").trim().toLowerCase();
    return CLASS_IDS.find((c) => c.toLowerCase() === clean) || "";
}

/** A known version id, else the version of everything stored before versions (TBC). */
function characterVersion(raw) {
    const id = String(raw || "").trim();
    return id && rulesFor(id) ? id : LEGACY_VERSION;
}

/** Whether a version's rule set plays this class (all three play the same nine today). */
function classInVersion(className, versionId) {
    const rules = rulesFor(versionId);
    return !rules || rules.classes.some((c) => c.id === className);
}

/** The rule set's spec record for a key, or null. */
function specInfo(key) {
    return SPEC_BY_KEY.get(String(key || "")) || null;
}

const profilesStore = createJsonStore({
    file: PROFILES_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && data.profiles && typeof data.profiles === "object" && !Array.isArray(data.profiles) ? data.profiles : {}),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = profilesStore.useFile;

function readAll() {
    return profilesStore.read();
}

function writeAll(profiles) {
    profilesStore.write({ profiles });
}

function cleanText(value, max) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** `true`/`false` as the raider set it, `null` = not set (the page derives it from the specs). */
function tristate(value) {
    return value === true || value === false ? value : null;
}

/** One spec entry: a spec of the character's class plus its gear level. */
function normalizeSpecs(raw, className) {
    const out = [];
    const seen = new Set();
    for (const entry of Array.isArray(raw) ? raw : []) {
        const key = String((entry && (entry.key || entry)) || "").trim();
        const info = specInfo(key);
        if (!info || info.classId !== className || seen.has(key)) continue;
        seen.add(key);
        const gear = GEAR_LEVELS.includes(entry && entry.gear) ? entry.gear : "usable";
        out.push({ key, gear });
    }
    return out;
}

function normalizeCharacter(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = cleanText(splitPlayer(raw.name || raw.character || "").character, MAX_NAME);
    const versionId = characterVersion(raw.versionId);
    const key = characterKeyOf(name, versionId);
    const className = normalizeClass(raw.className);
    if (!key || !className || !classInVersion(className, versionId)) return null;
    const armory = raw.armory && typeof raw.armory === "object" ? {
        level: Number(raw.armory.level) || null,
        guild: cleanText(raw.armory.guild, 48),
        fetchedAt: Number(raw.armory.fetchedAt) || 0,
    } : null;
    return {
        key,
        name,
        versionId,
        realm: cleanText(raw.realm, 32),
        className,
        source: CHARACTER_SOURCES.includes(raw.source) ? raw.source : "manual",
        specs: normalizeSpecs(raw.specs, className),
        // Per character: a druid main may tank while the priest twink never does.
        canOfftank: tristate(raw.canOfftank),
        canHeal: tristate(raw.canHeal),
        armory,
        addedAt: Number(raw.addedAt) || Date.now(),
    };
}

/**
 * How many of `characters` belong to `versionId` — the limit is per game
 * version: a raider moving from TBC to Forever keeps the old characters and
 * still has the full MAX_CHARACTERS for the new version.
 */
function countInVersion(characters, versionId) {
    const id = versionId || LEGACY_VERSION;
    return characters.filter((c) => (c.versionId || LEGACY_VERSION) === id).length;
}

/**
 * There is no "main" character — a main/twink split was felt as toxic. The
 * raider only orders the characters (`order` on save); the first one of a
 * version is what the system suggests where it must pick one (the signup's
 * preselection, a setup slot without a name), never labelled "Main".
 *
 * A profile stored while mains existed: the flagged character of each version
 * moves in front of that version's others, so nobody's suggestion changes,
 * and the flag is gone. Pure, stable otherwise.
 */
function legacyMainFirst(list) {
    if (!list.some((c) => c && typeof c === "object" && c.main === true)) return list;
    const versionOf = (c) => characterVersion(c && c.versionId);
    const out = [...list];
    const seen = new Set();
    for (const c of list) {
        if (!c || c.main !== true || seen.has(versionOf(c))) continue;
        seen.add(versionOf(c));
        const from = out.indexOf(c);
        const to = out.findIndex((x) => versionOf(x) === versionOf(c));
        if (to < from) out.splice(to, 0, ...out.splice(from, 1));
    }
    return out;
}

/**
 * `characters` in the raider's `order` (keys): the named ones first in that
 * order, any the list does not name after them as they were. Unknown keys are
 * ignored, so a save can only reorder, never add or drop.
 */
function inOrder(characters, order) {
    const rank = new Map(order.map((k, i) => [String(k), i]));
    const named = characters.filter((c) => rank.has(c.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
    return [...named, ...characters.filter((c) => !rank.has(c.key))];
}

/** A profile in its stored shape, whatever came in. Pure. */
function normalizeProfile(raw, userId = "") {
    const src = raw && typeof raw === "object" ? raw : {};
    const uid = String(userId || src.userId || "").trim();
    const characters = [];
    const keys = new Set();
    for (const c of legacyMainFirst(Array.isArray(src.characters) ? src.characters : [])) {
        const clean = normalizeCharacter(c);
        if (!clean || keys.has(clean.key) || countInVersion(characters, clean.versionId) >= MAX_CHARACTERS) continue;
        keys.add(clean.key);
        characters.push(clean);
    }
    const availability = WEEKDAYS.filter((d) => (Array.isArray(src.availability) ? src.availability : []).includes(d));
    const preferredRaids = [...new Set((Array.isArray(src.preferredRaids) ? src.preferredRaids : [])
        .map((id) => String(id || "").trim())
        .filter((id) => instanceById(id)))];
    const userIds = (list, max) => [...new Set((Array.isArray(list) ? list : [])
        .map((id) => String(id || "").trim())
        .filter((id) => isSnowflake(id) && id !== uid))].slice(0, max);
    const wishes = userIds(src.wishes, MAX_WISHES);
    // "Nicht mit X raiden" is off until the raider switches it on (past a
    // warning) — and switching it off forgets the names, so nothing lingers.
    const avoidEnabled = src.avoidEnabled === true;
    const avoid = avoidEnabled ? userIds(src.avoid, MAX_AVOID).filter((id) => !wishes.includes(id)) : [];
    return {
        userId: uid,
        name: cleanText(src.name, 64),
        characters,
        // The profile-wide switches from before they moved to the characters —
        // only the fallback of a character without a word of its own.
        canOfftank: tristate(src.canOfftank),
        canHeal: tristate(src.canHeal),
        availability,
        preferredRaids,
        wishes,
        avoidEnabled,
        avoid,
        note: String(src.note || "").trim().slice(0, MAX_NOTE),
        updatedAt: Number(src.updatedAt) || 0,
    };
}

/** The stored profile of an account, or an empty one. Never null for a valid id. */
function getProfile(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return null;
    return normalizeProfile(readAll()[uid] || {}, uid);
}

/** Whether the account has saved anything yet. */
function hasProfile(userId) {
    return !!readAll()[String(userId || "").trim()];
}

/** Every stored profile, normalized. */
function listProfiles() {
    return Object.entries(readAll()).map(([uid, p]) => normalizeProfile(p, uid));
}

function store(userId, profile) {
    const all = readAll();
    const saved = normalizeProfile({ ...profile, updatedAt: Date.now() }, userId);
    all[saved.userId] = saved;
    writeAll(all);
    return saved;
}

// The fields a raider edits with one save. Characters are added and removed on
// their own (addCharacter/removeCharacter); a save only changes what is known
// about the ones already there — specs, gear, their order.
const EDITABLE = ["canOfftank", "canHeal", "availability", "preferredRaids", "wishes", "avoidEnabled", "avoid", "note"];
// What a save may change about a character that is already there, besides specs.
const CHARACTER_EDITABLE = ["canOfftank", "canHeal"];

/**
 * Save the raider's own edits. `patch.characters` may carry `{ key, specs, canOfftank, canHeal }`
 * per existing character; a key that is not in the profile is ignored, so this
 * path can never add or take over a character. `patch.order` (keys) is the
 * order the raider put the characters in — the first of a version is the one
 * suggested for it (`firstCharacter`). Returns the saved profile.
 */
function saveProfile(userId, patch = {}, { name = "" } = {}) {
    const current = getProfile(userId);
    if (!current) return null;
    const next = { ...current, name: name || current.name };
    for (const field of EDITABLE) {
        if (patch[field] !== undefined) next[field] = patch[field];
    }
    if (Array.isArray(patch.characters)) {
        const edits = new Map(patch.characters.filter((c) => c && c.key).map((c) => [String(c.key), c]));
        next.characters = current.characters.map((c) => {
            const edit = edits.get(c.key);
            const next = {
                ...c,
                specs: edit && Array.isArray(edit.specs) ? edit.specs : c.specs,
            };
            for (const field of CHARACTER_EDITABLE) {
                // a class that cannot never stores a "yes"
                if (edit && edit[field] !== undefined) next[field] = edit[field] === true && !classCan(c.className)[field] ? null : edit[field];
            }
            return next;
        });
    }
    if (Array.isArray(patch.order)) next.characters = inOrder(next.characters || current.characters, patch.order);
    return store(userId, next);
}

/**
 * Add a character to the raider's own profile (or refresh one already there).
 * `data`: { name, realm, className, specs, source, armory }. Returns
 * `{ profile, character }`, or `{ error }` for a missing name/class, a name the
 * rule refuses or a full list.
 *
 * A *new* typed name (anything but `source: "log"`) must pass
 * utils/signup/characterNames.js — letters, 2–12 per name, the profanity filter, a
 * last name only where the character's version allows one.
 *
 * The character's version (#543) is `data.versionId`, else the `versionId`
 * option (the Discord name modal hands the event's), else TBC. The same name
 * in another version is another character.
 */
function addCharacter(userId, data = {}, { name = "", versionId = "" } = {}) {
    const current = getProfile(userId);
    if (!current) return { error: "Kein Konto." };
    const version = characterVersion(data.versionId || versionId);
    let clean = normalizeCharacter({ ...data, versionId: version, source: data.source });
    if (!clean) return { error: String(data.name || "").trim() ? "Bitte eine Klasse angeben." : "Bitte einen Namen angeben." };
    let existing = current.characters.find((c) => c.key === clean.key);
    if (!existing && clean.source !== "log") {
        const checked = validateCharacterName(splitPlayer(data.name || data.character || "").character, { versionId: version });
        if (checked.error) return { error: checked.error };
        clean = { ...clean, name: checked.name, key: characterKeyOf(checked.name, version) };
        existing = current.characters.find((c) => c.key === clean.key);
    }
    let characters;
    if (existing) {
        characters = current.characters.map((c) => (c.key === clean.key ? {
            ...c,
            realm: clean.realm || c.realm,
            className: clean.className,
            // A class change makes the old specs meaningless; otherwise merge.
            specs: c.className === clean.className ? mergeSpecs(c.specs, clean.specs) : clean.specs,
            armory: clean.armory || c.armory,
        } : c));
    } else {
        if (countInVersion(current.characters, version) >= MAX_CHARACTERS) {
            return { error: `Höchstens ${MAX_CHARACTERS} Charaktere je Spielversion (${(rulesFor(version) || {}).label || version}).` };
        }
        // a new character goes to the end — the raider moves it forward if it should come first
        characters = [...current.characters, clean];
    }
    const profile = store(userId, { ...current, name: name || current.name, characters });
    return { profile, character: profile.characters.find((c) => c.key === clean.key) };
}

function mergeSpecs(have, add) {
    const out = [...have];
    for (const s of add) if (!out.some((h) => h.key === s.key)) out.push(s);
    return out;
}

/** Take a character out of the raider's own profile. True when one was removed. */
function removeCharacter(userId, key) {
    const current = getProfile(userId);
    const k = characterKeyOf(key);
    if (!current || !k || !current.characters.some((c) => c.key === k)) return false;
    store(userId, { ...current, characters: current.characters.filter((c) => c.key !== k) });
    return true;
}

/** Which *other* accounts claim this character (a key, or a name plus its version): [{ userId, name }]. */
function claimsFor(character, exceptUserId = "", versionId = "") {
    const key = characterKeyOf(character, versionId);
    if (!key) return [];
    return listProfiles()
        .filter((p) => p.userId !== String(exceptUserId) && p.characters.some((c) => c.key === key))
        .map((p) => ({ userId: p.userId, name: p.name }));
}

/**
 * Characters more than one account has added — the orga's to-do list, shown as
 * a hint on the roster. `[{ key, character, className, claims: [{ userId, name }] }]`.
 */
function characterClaims() {
    const byKey = new Map();
    for (const p of listProfiles()) {
        for (const c of p.characters) {
            if (!byKey.has(c.key)) byKey.set(c.key, { key: c.key, character: c.name, versionId: c.versionId, className: c.className, claims: [] });
            byKey.get(c.key).claims.push({ userId: p.userId, name: p.name });
        }
    }
    return [...byKey.values()].filter((e) => e.claims.length > 1).sort((a, b) => a.key.localeCompare(b.key));
}

/** What the specs of these characters allow — the default of the two switches. */
function specRoles(characters) {
    const specs = (characters || []).flatMap((c) => (c.specs || []).map((s) => specInfo(s.key) || {}));
    return { canOfftank: specs.some((s) => s.canTank), canHeal: specs.some((s) => s.canHeal) };
}

/** Whether a class has any spec that can tank / heal: `{ canOfftank, canHeal }`. Unknown class → both true. */
function classCan(className) {
    return CLASS_CAN.get(normalizeClass(className)) || { canOfftank: true, canHeal: true };
}

/**
 * "Kann offtanken / heilen" of one character: its own switch, else the old
 * profile-wide one, else what its specs allow — and never for a class that
 * cannot (`possible`), so an old "kann heilen" on the profile does not make a
 * mage a healer. `explicit` is the stated word alone (`null` = nobody said
 * anything) — the setup proposal only acts on that.
 */
function characterRoles(profile, character) {
    const suggested = specRoles(character ? [character] : []);
    const possible = character ? classCan(character.className) : { canOfftank: true, canHeal: true };
    const explicit = {};
    const out = { suggested, explicit, possible };
    for (const field of CHARACTER_EDITABLE) {
        const own = character ? tristate(character[field]) : null;
        explicit[field] = !possible[field] ? false : (own !== null ? own : tristate(profile && profile[field]));
        out[field] = explicit[field] !== null ? explicit[field] : suggested[field];
    }
    return out;
}

/**
 * The characters of one game version (#543) — what a signup for an event of
 * that version may pick from. No version = all of them.
 */
function charactersOfVersion(profile, versionId = "") {
    const all = (profile && Array.isArray(profile.characters)) ? profile.characters : [];
    const id = String(versionId || "").trim();
    return id ? all.filter((c) => (c.versionId || LEGACY_VERSION) === id) : all;
}

/**
 * A profile character by key or by name. With `versionId` only a character of
 * that version counts (a Forever "Devi" never answers for a TBC signup); a name
 * matches by its name part, so "Devi Res" finds "forever~devi res". Without a
 * version an exact key wins, then a TBC character of that name, then any.
 */
function findCharacter(profile, ref, versionId = "") {
    const key = characterKeyOf(ref);
    if (!key) return null;
    const pool = charactersOfVersion(profile, versionId);
    const name = nameKeyOf(ref);
    return pool.find((c) => c.key === key)
        || pool.find((c) => c.key === name)
        || pool.find((c) => nameKeyOf(c.key) === name)
        || null;
}

/**
 * One-off upgrade at start (#543, settingsMigration.js): every stored character
 * without a (known) version becomes a TBC one. Keys do not move — a TBC key is
 * the bare name. Idempotent: writes only when something changed.
 * @returns {number} how many characters got a version
 */
function migrateCharacterVersions(versionId = LEGACY_VERSION) {
    const all = readAll();
    let changed = 0;
    for (const profile of Object.values(all)) {
        for (const c of (profile && Array.isArray(profile.characters)) ? profile.characters : []) {
            if (!c || typeof c !== "object" || (c.versionId && rulesFor(c.versionId))) continue;
            c.versionId = versionId;
            changed += 1;
        }
    }
    if (changed) writeAll(all);
    return changed;
}

/**
 * The raider's first character — of `versionId` when given, else of
 * `preferVersion` (the caller's main game version) when it has one there, else
 * the first at all. There is no main (legacyMainFirst): the raider's own order
 * decides. Null without characters.
 */
function firstCharacter(profile, versionId = "", { preferVersion = "" } = {}) {
    if (!profile) return null;
    if (versionId) return charactersOfVersion(profile, versionId)[0] || null;
    return (preferVersion && charactersOfVersion(profile, preferVersion)[0]) || profile.characters[0] || null;
}

/**
 * Search the raiders who have a profile, for the "gerne zusammen raiden mit"
 * picker. Names only — never anybody's wishes, notes or availability.
 * `preferVersion`: whose characters name a raider (raiderRef).
 */
function searchRaiders(query, exceptUserId = "", limit = 10, { preferVersion = "" } = {}) {
    const q = String(query || "").trim().toLowerCase();
    return listProfiles()
        .filter((p) => p.userId !== String(exceptUserId))
        .filter((p) => p.name || p.characters.length)
        .filter((p) => !q
            || p.name.toLowerCase().includes(q)
            || p.characters.some((c) => c.name.toLowerCase().includes(q)))
        .map((p) => raiderRef(p, { preferVersion }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit);
}

/**
 * How another raider appears in someone's profile: name, their first character
 * (of `preferVersion` when they have one there) and its class — nothing else.
 */
function raiderRef(profile, { preferVersion = "" } = {}) {
    const first = firstCharacter(profile, "", { preferVersion });
    return {
        userId: profile.userId,
        name: profile.name || (first && first.name) || profile.userId,
        character: first ? first.name : "",
        className: first ? first.className : "",
    };
}

/**
 * One-off upgrade at start (settingsMigration.js): a profile stored while mains
 * existed is written in the order without them — each version's former main
 * first, the flag gone (legacyMainFirst). Idempotent.
 * @returns {number} how many profiles were rewritten
 */
function migrateCharacterOrder() {
    const all = readAll();
    let changed = 0;
    for (const [userId, raw] of Object.entries(all)) {
        const chars = (raw && Array.isArray(raw.characters)) ? raw.characters : [];
        if (!chars.some((c) => c && typeof c === "object" && "main" in c)) continue;
        raw.characters = legacyMainFirst(chars).map((c) => {
            if (!c || typeof c !== "object") return c;
            const rest = { ...c };
            delete rest.main;
            return rest;
        });
        all[userId] = raw;
        changed += 1;
    }
    if (changed) writeAll(all);
    return changed;
}

/** Drop everything — tests only. */
function reset() {
    profilesStore.remove();
}

module.exports = {
    GEAR_LEVELS, WEEKDAYS, CHARACTER_SOURCES, MAX_CHARACTERS, MAX_WISHES, MAX_AVOID, MAX_NOTE,
    characterKey: characterKeyOf, nameKey: nameKeyOf, characterVersion, charactersOfVersion, findCharacter, migrateCharacterVersions, migrateCharacterOrder,
    normalizeClass, specInfo, normalizeProfile, specRoles, characterRoles, classCan,
    getProfile, hasProfile, listProfiles, saveProfile, addCharacter, removeCharacter,
    claimsFor, characterClaims, firstCharacter, searchRaiders, raiderRef, reset, useFile,
    PROFILES_FILE,
};
