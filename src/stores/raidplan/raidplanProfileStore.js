// Tactic profiles of the raid plan: named, categorised sets of target rows that
// the orga picks for a boss board instead of typing the rows again.
//
// { id, serverId, name, category, versionId, bossKey, steps: [step], targets: [{ title }], notes, updatedAt }
//   serverId  the Discord server the profile belongs to (#945): the library is per server, a profile is read and
//             written only through its own server; an entry without one is an old global entry (never listed, the
//             start copies it onto every server under the same id, migrateToServers)
//   versionId the game version (#544): a plan offers only the tactics of its own version
//   name      free, required
//   category  free text ("Tank", "Heiler", "Phase 1" …); the editor offers the
//             ones that exist and lets a new one be typed
//   bossKey   "" = for every boss; an instance id = for that instance's bosses;
//             a boss key (raidplanStore.bossKeyOf) = for that boss only
//   steps     the tactic: ordered steps like a board's (raidplanSteps.js) with slots and classes only (no players: a
//             library tactic is for any raid); applying one ADDS its steps under the board's (nothing is replaced)
//   targets   the old row titles (profiles from before the steps): read as "note" steps, never lost
//   notes     the note the board gets when the profile is applied
// Nothing is shipped: no boss mechanics are invented here, the orga writes the
// profiles.
const fs = require("fs");
const path = require("path");
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");
const { isMapKey } = require("./raidplanStore");
const { instanceById, rulesFor, LEGACY_VERSION } = require("../../config/gameVersions");
const stepsOf = require("../../services/raidplan/raidplanSteps");
const { str } = require("../../utils/text");
const { isSnowflake, newId } = require("../../utils/ids");

const DEFAULT_FILE = settingsPath("raidplan-profiles.json");

const LIMITS = { profiles: 200, name: 40, category: 30, title: 80, targets: 30, notes: 1000 };


const store = createJsonStore({
    file: DEFAULT_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.profiles) ? data.profiles : []),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

function readAll() {
    return store.read();
}

function writeAll(profiles) {
    store.write({ profiles });
}

/**
 * The game version of a stored profile: its own when known, else the version of the instance its boss belongs to, else
 * TBC (every profile before #544 was a TBC one; settingsMigration writes it down once).
 */
function versionOf(r) {
    if (rulesFor(str(r.versionId))) return str(r.versionId);
    const inst = instanceById(str(r.bossKey).split("/")[0]);
    return inst ? inst.versionId : LEGACY_VERSION;
}

/** A profile as stored: every field present, texts cut to their limits. */
function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const targets = (Array.isArray(r.targets) ? r.targets : [])
        .map((t) => ({ title: str(t && typeof t === "object" ? t.title : t).slice(0, LIMITS.title) }))
        .filter((t) => t.title)
        .slice(0, LIMITS.targets);
    // steps; a profile from before the steps has only row titles: each becomes a "note" step (nothing is lost)
    const steps = Array.isArray(r.steps) ? stepsOf.cleanSteps(r.steps.slice(0, stepsOf.LIMITS.steps), new Set()).steps || [] : stepsOf.stepsFromTitles(targets);
    return {
        id: str(r.id),
        serverId: isSnowflake(str(r.serverId)) ? str(r.serverId) : "",
        name: str(r.name).slice(0, LIMITS.name),
        category: str(r.category).slice(0, LIMITS.category),
        versionId: versionOf(r),
        bossKey: str(r.bossKey),
        steps,
        targets,
        notes: String(r.notes === undefined || r.notes === null ? "" : r.notes).slice(0, LIMITS.notes),
        updatedAt: Number(r.updatedAt) || 0,
    };
}

/** The server id a call names, "" when it is none (fail closed: no server, no profiles). */
function serverKey(serverId) {
    const key = str(serverId);
    return isSnowflake(key) ? key : "";
}

/** The profiles of one server, by category then name; [] without a server. */
function listProfiles(serverId) {
    const server = serverKey(serverId);
    if (!server) return [];
    return readAll().map(normalize).filter((p) => p.id && p.name && p.serverId === server)
        .sort((a, b) => a.category.localeCompare(b.category, "de") || a.name.localeCompare(b.name, "de"));
}

/** A profile of the server (a copied one keeps the global id, #945); null on another server. */
function getProfile(serverId, id) {
    const key = str(id);
    return key ? listProfiles(serverId).find((p) => p.id === key) || null : null;
}

/** The index of a profile of the server in the raw list, -1 when it has none of that id. */
function indexOn(all, serverId, id) {
    const server = serverKey(serverId);
    const key = str(id);
    if (!server || !key) return -1;
    return all.findIndex((p) => p && p.id === key && str(p.serverId) === server);
}

/** The distinct categories in use, sorted. */
function categories(profiles = []) {
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
    if (body.versionId !== undefined) {
        if (!rulesFor(str(body.versionId))) return { code: "invalid", error: "Unbekannte Spielversion." };
        value.versionId = str(body.versionId);
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
    if (body.steps !== undefined) {
        if (!Array.isArray(body.steps)) return { code: "invalid", error: "Die Schritte haben ein ungültiges Format." };
        const cleaned = stepsOf.cleanSteps(body.steps, new Set());
        if (cleaned.error) return cleaned;
        value.steps = cleaned.steps;
    }
    if (body.notes !== undefined) {
        const notes = String(body.notes === null ? "" : body.notes);
        if (notes.length > LIMITS.notes) return { code: "invalid", error: `Die Notiz darf höchstens ${LIMITS.notes} Zeichen haben.` };
        value.notes = notes;
    }
    return { value };
}

/** Creates a profile. Returns `{ profile }` or `{ code, error }`. */
function createProfile(serverId, input, { now = Date.now() } = {}) {
    const server = serverKey(serverId);
    if (!server) return { code: "invalid", error: "Kein Discord-Server." };
    const checked = validate(input);
    if (checked.error) return checked;
    const all = readAll();
    if (all.filter((p) => p && str(p.serverId) === server).length >= LIMITS.profiles) return { code: "invalid", error: `Höchstens ${LIMITS.profiles} Profile.` };
    const profile = normalize({ ...checked.value, id: newId(), serverId: server, updatedAt: now });
    all.push(profile);
    writeAll(all);
    return { profile };
}

/** Changes the given fields of a profile. Returns `{ profile }` or `{ code, error }`. */
function updateProfile(serverId, id, input, { now = Date.now() } = {}) {
    const key = str(id);
    const all = readAll();
    const idx = indexOn(all, serverId, key);
    if (idx === -1) return { code: "not_found", error: "Profil nicht gefunden." };
    const checked = validate(input, { partial: true });
    if (checked.error) return checked;
    const profile = normalize({ ...all[idx], ...checked.value, id: key, serverId: all[idx].serverId, updatedAt: now });
    all[idx] = profile;
    writeAll(all);
    return { profile };
}

/** Deletes a profile of the server. True when there was one. */
function deleteProfile(serverId, id) {
    const all = readAll();
    const idx = indexOn(all, serverId, id);
    if (idx === -1) return false;
    writeAll(all.filter((_, i) => i !== idx));
    return true;
}

/**
 * One-off upgrade at start (#544, settingsMigration.js): a profile stored without `versionId` gets the one it is read
 * with (its boss's version, else TBC). Idempotent. Returns how many profiles changed.
 */
function migrateVersions() {
    const all = readAll();
    let changed = 0;
    const next = all.map((p) => {
        if (!p || typeof p !== "object" || rulesFor(str(p.versionId))) return p;
        changed += 1;
        return { ...p, versionId: versionOf(p) };
    });
    if (changed) writeAll(next);
    return changed;
}

/**
 * One-off upgrade at start (#945, settingsMigration.js): the library is per server. Every old global profile (no
 * `serverId`) is copied onto each server in `serverIds` under the same id (a plan's board names it, `board.profileId`,
 * and finds its own server's copy); from then on the copies are independent. Idempotent: a server that already has a
 * profile of that id gets no second copy. The file is backed up once (`<file>.pre-945`) before the first write; the
 * global entries go only after the copies were read back from disk, else they stay (never listed) and the next start
 * tries again.
 * @param {string[]} serverIds the servers, the main one first
 * @returns {string[]} log lines
 */
function migrateToServers(serverIds) {
    const servers = [...new Set((Array.isArray(serverIds) ? serverIds : []).map(str).filter(isSnowflake))];
    const legacyOf = (list) => list.filter((p) => p && typeof p === "object" && !isSnowflake(str(p.serverId)) && str(p.id));
    const all = readAll();
    const legacy = legacyOf(all);
    if (!legacy.length) return [];
    if (!servers.length) return ["raidplan-profiles.json: WARNUNG - Taktik-Profile (#945) nicht je Server übernommen: kein Discord-Server eingetragen; sie bleiben gespeichert, bis ein Server eingetragen ist"];
    const file = store.file;
    const backup = `${file}.pre-945`;
    if (fs.existsSync(file) && !fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(file));
    const has = (list, server, id) => list.some((x) => x && str(x.serverId) === server && x.id === id);
    const next = all.slice();
    let copies = 0;
    for (const p of legacy) {
        for (const server of servers) {
            if (has(next, server, str(p.id))) continue;
            next.push({ ...p, serverId: server });
            copies += 1;
        }
    }
    if (copies) writeAll(next);
    const written = readAll();
    if (!legacy.every((p) => servers.every((server) => has(written, server, str(p.id))))) {
        return ["raidplan-profiles.json: WARNUNG - Taktik-Profile je Server (#945) nicht vollständig gespeichert; die bisherigen bleiben, der nächste Start versucht es erneut"];
    }
    const gone = new Set(legacyOf(written));
    writeAll(written.filter((p) => !gone.has(p)));
    return [`raidplan-profiles.json: ${legacy.length} Taktik-Profil(e) je Server übernommen (#945) - ${copies} Kopie(n) auf ${servers.length} Server, globale Einträge entfernt (Sicherung ${path.basename(backup)})`];
}

module.exports = { migrateToServers, migrateVersions, useFile, LIMITS, listProfiles, getProfile, categories, createProfile, updateProfile, deleteProfile };
