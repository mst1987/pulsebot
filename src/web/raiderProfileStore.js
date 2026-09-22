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
// Stored under data/settings/raider-profiles.json like the other stores.

const fs = require("fs");
const path = require("path");
const { characterKey: lootCharacterKey, splitPlayer } = require("../utils/lootImport");
const { CLASSES, buildClasses } = require("../config/gameVersions/classes");
const { instanceById } = require("../config/gameVersions");
const { validateCharacterName, NAME_MAX } = require("../utils/characterNames");

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const PROFILES_FILE = path.join(SETTINGS_DIR, "raider-profiles.json");
// Tests point the store at a file of their own (useFile), so suites running in
// parallel never share one.
let profilesFile = PROFILES_FILE;

/** Tests only: read and write another file. */
function useFile(file) {
    profilesFile = file || PROFILES_FILE;
}

// Gear per spec: nothing yet, good enough to be carried, raid ready.
const GEAR_LEVELS = ["none", "usable", "ready"];
const WEEKDAYS = ["mo", "di", "mi", "do", "fr", "sa", "so"];
// Where a character came from — shown as a small badge, never a permission.
const CHARACTER_SOURCES = ["log", "armory", "manual"];

const MAX_CHARACTERS = 12;
const MAX_WISHES = 10;
const MAX_AVOID = 10;
const MAX_NOTE = 500;
// Forever's "Vorname Nachname": 12 + 1 + 12 (utils/characterNames.js).
const MAX_NAME = NAME_MAX;

const SPEC_BY_KEY = new Map();
// What a class can step in as at all — a mage never tanks nor heals, whatever a switch says.
const CLASS_CAN = new Map();
for (const c of buildClasses(CLASSES)) {
    for (const s of c.specs) SPEC_BY_KEY.set(s.key, s);
    CLASS_CAN.set(c.id, { canOfftank: c.specs.some((s) => s.canTank), canHeal: c.specs.some((s) => s.canHeal) });
}
const CLASS_IDS = CLASSES.map((c) => c.id);

/** Keyed like characterStore/lootStore: lower case, without the realm suffix. */
function characterKey(character) {
    return lootCharacterKey(splitPlayer(character).character);
}

/** "mage", "MAGE", "Mage" -> "Mage"; "" for anything that is not a class. */
function normalizeClass(raw) {
    const clean = String(raw || "").trim().toLowerCase();
    return CLASS_IDS.find((c) => c.toLowerCase() === clean) || "";
}

/** The rule set's spec record for a key, or null. */
function specInfo(key) {
    return SPEC_BY_KEY.get(String(key || "")) || null;
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(profilesFile, "utf8"));
        return data && data.profiles && typeof data.profiles === "object" && !Array.isArray(data.profiles) ? data.profiles : {};
    } catch {
        return {};
    }
}

function writeAll(profiles) {
    fs.mkdirSync(path.dirname(profilesFile), { recursive: true });
    fs.writeFileSync(profilesFile, JSON.stringify({ profiles }, null, 2));
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
    const key = characterKey(name);
    const className = normalizeClass(raw.className);
    if (!key || !className) return null;
    const armory = raw.armory && typeof raw.armory === "object" ? {
        level: Number(raw.armory.level) || null,
        guild: cleanText(raw.armory.guild, 48),
        fetchedAt: Number(raw.armory.fetchedAt) || 0,
    } : null;
    return {
        key,
        name,
        realm: cleanText(raw.realm, 32),
        className,
        main: !!raw.main,
        source: CHARACTER_SOURCES.includes(raw.source) ? raw.source : "manual",
        specs: normalizeSpecs(raw.specs, className),
        // Per character: a druid main may tank while the priest twink never does.
        canOfftank: tristate(raw.canOfftank),
        canHeal: tristate(raw.canHeal),
        armory,
        addedAt: Number(raw.addedAt) || Date.now(),
    };
}

/** Exactly one main when there are characters: the first flagged, else the first. */
function withOneMain(characters) {
    const mainIdx = Math.max(0, characters.findIndex((c) => c.main));
    return characters.map((c, i) => ({ ...c, main: i === mainIdx }));
}

/** A profile in its stored shape, whatever came in. Pure. */
function normalizeProfile(raw, userId = "") {
    const src = raw && typeof raw === "object" ? raw : {};
    const uid = String(userId || src.userId || "").trim();
    const characters = [];
    const keys = new Set();
    for (const c of Array.isArray(src.characters) ? src.characters : []) {
        const clean = normalizeCharacter(c);
        if (!clean || keys.has(clean.key) || characters.length >= MAX_CHARACTERS) continue;
        keys.add(clean.key);
        characters.push(clean);
    }
    const availability = WEEKDAYS.filter((d) => (Array.isArray(src.availability) ? src.availability : []).includes(d));
    const preferredRaids = [...new Set((Array.isArray(src.preferredRaids) ? src.preferredRaids : [])
        .map((id) => String(id || "").trim())
        .filter((id) => instanceById(id)))];
    const userIds = (list, max) => [...new Set((Array.isArray(list) ? list : [])
        .map((id) => String(id || "").trim())
        .filter((id) => /^\d{5,25}$/.test(id) && id !== uid))].slice(0, max);
    const wishes = userIds(src.wishes, MAX_WISHES);
    // "Nicht mit X raiden" is off until the raider switches it on (past a
    // warning) — and switching it off forgets the names, so nothing lingers.
    const avoidEnabled = src.avoidEnabled === true;
    const avoid = avoidEnabled ? userIds(src.avoid, MAX_AVOID).filter((id) => !wishes.includes(id)) : [];
    return {
        userId: uid,
        name: cleanText(src.name, 64),
        characters: withOneMain(characters),
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
// about the ones already there — specs, gear, which one is the main.
const EDITABLE = ["canOfftank", "canHeal", "availability", "preferredRaids", "wishes", "avoidEnabled", "avoid", "note"];
// What a save may change about a character that is already there, besides specs and main.
const CHARACTER_EDITABLE = ["canOfftank", "canHeal"];

/**
 * Save the raider's own edits. `patch.characters` may carry `{ key, main, specs, canOfftank, canHeal }`
 * per existing character; a key that is not in the profile is ignored, so this
 * path can never add or take over a character. Returns the saved profile.
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
        const mainKey = patch.characters.find((c) => c && c.main) ? String(patch.characters.find((c) => c && c.main).key) : "";
        next.characters = current.characters.map((c) => {
            const edit = edits.get(c.key);
            const next = {
                ...c,
                main: mainKey ? c.key === mainKey : c.main,
                specs: edit && Array.isArray(edit.specs) ? edit.specs : c.specs,
            };
            for (const field of CHARACTER_EDITABLE) {
                // a class that cannot never stores a "yes"
                if (edit && edit[field] !== undefined) next[field] = edit[field] === true && !classCan(c.className)[field] ? null : edit[field];
            }
            return next;
        });
    }
    return store(userId, next);
}

/**
 * Add a character to the raider's own profile (or refresh one already there).
 * `data`: { name, realm, className, specs, source, armory }. Returns
 * `{ profile, character }`, or `{ error }` for a missing name/class, a name the
 * rule refuses or a full list.
 *
 * A *new* typed name (anything but `source: "log"`) must pass
 * utils/characterNames.js — letters, 2–12 per name, the profanity filter, a
 * last name only where `versionId` allows one (none given = the web profile,
 * which is not tied to a version, allows it).
 */
function addCharacter(userId, data = {}, { name = "", versionId = "" } = {}) {
    const current = getProfile(userId);
    if (!current) return { error: "Kein Konto." };
    let clean = normalizeCharacter({ ...data, source: data.source, main: false });
    if (!clean) return { error: String(data.name || "").trim() ? "Bitte eine Klasse angeben." : "Bitte einen Namen angeben." };
    let existing = current.characters.find((c) => c.key === clean.key);
    if (!existing && clean.source !== "log") {
        const checked = validateCharacterName(splitPlayer(data.name || data.character || "").character, { versionId });
        if (checked.error) return { error: checked.error };
        clean = { ...clean, name: checked.name, key: characterKey(checked.name) };
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
        if (current.characters.length >= MAX_CHARACTERS) return { error: `Höchstens ${MAX_CHARACTERS} Charaktere.` };
        characters = [...current.characters, { ...clean, main: current.characters.length === 0 }];
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
    const k = characterKey(key);
    if (!current || !k || !current.characters.some((c) => c.key === k)) return false;
    store(userId, { ...current, characters: current.characters.filter((c) => c.key !== k) });
    return true;
}

/** Which *other* accounts claim this character: [{ userId, name }]. */
function claimsFor(character, exceptUserId = "") {
    const key = characterKey(character);
    if (!key) return [];
    return listProfiles()
        .filter((p) => p.userId !== String(exceptUserId) && p.characters.some((c) => c.key === key))
        .map((p) => ({ userId: p.userId, name: p.name }));
}

/**
 * Characters more than one account has added — the orga's to-do list, shown as
 * a hint on the roster. `[{ key, character, className, claims: [{ userId, name, main }] }]`.
 */
function characterClaims() {
    const byKey = new Map();
    for (const p of listProfiles()) {
        for (const c of p.characters) {
            if (!byKey.has(c.key)) byKey.set(c.key, { key: c.key, character: c.name, className: c.className, claims: [] });
            byKey.get(c.key).claims.push({ userId: p.userId, name: p.name, main: c.main });
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

/** The main character of a profile, or null. */
function mainCharacter(profile) {
    return (profile && profile.characters.find((c) => c.main)) || null;
}

/**
 * Search the raiders who have a profile, for the "gerne zusammen raiden mit"
 * picker. Names only — never anybody's wishes, notes or availability.
 */
function searchRaiders(query, exceptUserId = "", limit = 10) {
    const q = String(query || "").trim().toLowerCase();
    return listProfiles()
        .filter((p) => p.userId !== String(exceptUserId))
        .filter((p) => p.name || p.characters.length)
        .filter((p) => !q
            || p.name.toLowerCase().includes(q)
            || p.characters.some((c) => c.key.includes(q)))
        .map((p) => raiderRef(p))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit);
}

/** How another raider appears in someone's profile: name, main and its class — nothing else. */
function raiderRef(profile) {
    const main = mainCharacter(profile);
    return {
        userId: profile.userId,
        name: profile.name || (main && main.name) || profile.userId,
        main: main ? main.name : "",
        className: main ? main.className : "",
    };
}

/** Drop everything — tests only. */
function reset() {
    try {
        fs.unlinkSync(profilesFile);
    } catch {
        // never existed
    }
}

module.exports = {
    GEAR_LEVELS, WEEKDAYS, CHARACTER_SOURCES, MAX_CHARACTERS, MAX_WISHES, MAX_AVOID, MAX_NOTE,
    characterKey, normalizeClass, specInfo, normalizeProfile, specRoles, characterRoles, classCan,
    getProfile, hasProfile, listProfiles, saveProfile, addCharacter, removeCharacter,
    claimsFor, characterClaims, mainCharacter, searchRaiders, raiderRef, reset, useFile,
    PROFILES_FILE,
};
