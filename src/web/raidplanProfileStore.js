// Tactic profiles of the raid plan: named, categorised sets of target rows that
// the orga picks for a boss board instead of typing the rows again.
//
// { id, name, category, bossKey, targets: [{ title }], notes, updatedAt }
//   name      free, required
//   category  free text ("Tank", "Heiler", "Phase 1" …); the editor offers the
//             ones that exist and lets a new one be typed
//   bossKey   "" = for every boss; an instance id = for that instance's bosses;
//             a boss key (raidplanStore.bossKeyOf) = for that boss only
//   targets   the row titles only — who stands on a row is decided per plan
//   notes     the note the board gets when the profile is applied
// Nothing is shipped: no boss mechanics are invented here, the orga writes the
// profiles.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isMapKey } = require("./raidplanStore");

const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "settings", "raidplan-profiles.json");

const LIMITS = { profiles: 200, name: 40, category: 30, title: 80, targets: 30, notes: 1000 };

let profileFile = DEFAULT_FILE;

/** Tests point the store at a file of their own. */
function useFile(file) {
    profileFile = file || DEFAULT_FILE;
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(profileFile, "utf8"));
        return Array.isArray(data.profiles) ? data.profiles : [];
    } catch {
        return [];
    }
}

function writeAll(profiles) {
    fs.mkdirSync(path.dirname(profileFile), { recursive: true });
    fs.writeFileSync(profileFile, JSON.stringify({ profiles }, null, 2));
}

/** A profile as stored: every field present, texts cut to their limits. */
function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const targets = (Array.isArray(r.targets) ? r.targets : [])
        .map((t) => ({ title: str(t && typeof t === "object" ? t.title : t).slice(0, LIMITS.title) }))
        .filter((t) => t.title)
        .slice(0, LIMITS.targets);
    return {
        id: str(r.id),
        name: str(r.name).slice(0, LIMITS.name),
        category: str(r.category).slice(0, LIMITS.category),
        bossKey: str(r.bossKey),
        targets,
        notes: String(r.notes === undefined || r.notes === null ? "" : r.notes).slice(0, LIMITS.notes),
        updatedAt: Number(r.updatedAt) || 0,
    };
}

/** All profiles, by category then name. */
function listProfiles() {
    return readAll().map(normalize).filter((p) => p.id && p.name)
        .sort((a, b) => a.category.localeCompare(b.category, "de") || a.name.localeCompare(b.name, "de"));
}

function getProfile(id) {
    const key = str(id);
    return key ? listProfiles().find((p) => p.id === key) || null : null;
}

/** The distinct categories in use, sorted. */
function categories(profiles = listProfiles()) {
    return [...new Set(profiles.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
}

/** Checks a body's fields; returns `{ value }` or `{ code: "invalid", error }`. */
function validate(input, { partial = false } = {}) {
    const body = input && typeof input === "object" ? input : {};
    const value = {};
    if (!partial || body.name !== undefined) {
        const name = str(body.name);
        if (!name) return { code: "invalid", error: "Der Name fehlt." };
        if (name.length > LIMITS.name) return { code: "invalid", error: `Der Name darf höchstens ${LIMITS.name} Zeichen haben.` };
        value.name = name;
    }
    if (body.category !== undefined) {
        const category = str(body.category);
        if (category.length > LIMITS.category) return { code: "invalid", error: `Die Kategorie darf höchstens ${LIMITS.category} Zeichen haben.` };
        value.category = category;
    }
    if (body.bossKey !== undefined) {
        const bossKey = str(body.bossKey);
        if (bossKey && !isMapKey(bossKey)) return { code: "invalid", error: "Unbekannter Boss oder Instanz." };
        value.bossKey = bossKey;
    }
    if (body.targets !== undefined) {
        if (!Array.isArray(body.targets)) return { code: "invalid", error: "Die Aufgabenzeilen haben ein ungültiges Format." };
        if (body.targets.length > LIMITS.targets) return { code: "invalid", error: `Höchstens ${LIMITS.targets} Aufgabenzeilen je Profil.` };
        value.targets = body.targets;
    }
    if (body.notes !== undefined) {
        const notes = String(body.notes === null ? "" : body.notes);
        if (notes.length > LIMITS.notes) return { code: "invalid", error: `Die Notiz darf höchstens ${LIMITS.notes} Zeichen haben.` };
        value.notes = notes;
    }
    return { value };
}

/** Creates a profile. Returns `{ profile }` or `{ code, error }`. */
function createProfile(input, { now = Date.now() } = {}) {
    const checked = validate(input);
    if (checked.error) return checked;
    const all = readAll();
    if (all.length >= LIMITS.profiles) return { code: "invalid", error: `Höchstens ${LIMITS.profiles} Profile.` };
    const profile = normalize({ ...checked.value, id: crypto.randomBytes(6).toString("hex"), updatedAt: now });
    all.push(profile);
    writeAll(all);
    return { profile };
}

/** Changes the given fields of a profile. Returns `{ profile }` or `{ code, error }`. */
function updateProfile(id, input, { now = Date.now() } = {}) {
    const key = str(id);
    const all = readAll();
    const idx = all.findIndex((p) => p && p.id === key);
    if (idx === -1) return { code: "not_found", error: "Profil nicht gefunden." };
    const checked = validate(input, { partial: true });
    if (checked.error) return checked;
    const profile = normalize({ ...all[idx], ...checked.value, id: key, updatedAt: now });
    all[idx] = profile;
    writeAll(all);
    return { profile };
}

/** Deletes a profile. True when there was one. */
function deleteProfile(id) {
    const key = str(id);
    const all = readAll();
    const rest = all.filter((p) => !(p && p.id === key));
    if (rest.length === all.length) return false;
    writeAll(rest);
    return true;
}

module.exports = { useFile, LIMITS, listProfiles, getProfile, categories, createProfile, updateProfile, deleteProfile };
