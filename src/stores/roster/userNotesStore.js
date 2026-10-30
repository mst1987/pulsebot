// Vermerke (docs/vermerke.md, #979): notes the orga of a Discord server keeps on
// a Discord account - a hint, a warning or a shadowban, with a reason, a free
// text, the raids it is about, an optional expiry and its history.
//
//   data/settings/user-notes.json = {
//       guilds: { [guildId]: { [userId]: { name, entries: [entry] } } },
//       hidden: { [guildId]: { [entryId]: { by, at } } },
//   }
//   entry = { id, level, reason, text, eventIds, expiresAt, shared, by, byName, at,
//             archived?, archivedAt?, archivedBy?, history: [{ by, byName, at, action, changes }] }
//
// A shared entry is readable on every server; only its server of origin
// changes it. Another server may hide it for itself (`hidden`, nothing is
// deleted). Archiving keeps the entry; removing it for good is for full admins
// (the route checks that). Expired, archived and hidden entries do not count.
//
// Nothing here ever reaches the person it is about: only the Vermerke routes
// and the short form (services/vermerke/vermerkeShort.js - level and reason
// counts, never the text) read this store (test/stores/roster/userNotesStore.test.js
// keeps the list).
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");
const { newId } = require("../../utils/ids");

const LEVELS = ["hint", "warning", "shadowban"];
const REASONS = ["left_early", "no_show", "late_signoff", "left_server", "behavior", "loot", "other"];
const MAX_TEXT = 1000;
const MAX_ENTRIES = 50;
const MAX_EVENTS = 20;
const MAX_NAME = 100;
const MAX_HISTORY = 100;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const keyOf = (guildId) => str(guildId) || "_";
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A thrown refusal the route turns into an answer: `status`, `code`. */
class NoteError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const levelRank = (level) => LEVELS.indexOf(level);

function normExpires(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Date.parse(String(v));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function normEventIds(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(str).filter(Boolean))].slice(0, MAX_EVENTS);
}

function normHistory(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isObj).map((h) => ({
        by: str(h.by),
        byName: str(h.byName).slice(0, MAX_NAME),
        at: Number(h.at) || 0,
        action: str(h.action) || "update",
        changes: Array.isArray(h.changes) ? h.changes.map(str).filter(Boolean) : [],
    })).slice(-MAX_HISTORY);
}

/** One stored entry, normalised; null when it is no entry (no id, unknown level). */
function normalizeEntry(e) {
    if (!isObj(e)) return null;
    const id = str(e.id);
    const level = str(e.level);
    if (!id || !LEVELS.includes(level)) return null;
    const reason = REASONS.includes(str(e.reason)) ? str(e.reason) : "other";
    const out = {
        id,
        level,
        reason,
        text: str(e.text).slice(0, MAX_TEXT),
        eventIds: normEventIds(e.eventIds),
        expiresAt: normExpires(e.expiresAt),
        shared: e.shared === true,
        by: str(e.by),
        byName: str(e.byName).slice(0, MAX_NAME),
        at: Number(e.at) || 0,
        history: normHistory(e.history),
    };
    if (e.archived === true) {
        out.archived = true;
        out.archivedAt = Number(e.archivedAt) || 0;
        out.archivedBy = str(e.archivedBy);
    }
    return out;
}

function normalizePerson(p) {
    if (!isObj(p)) return null;
    const entries = (Array.isArray(p.entries) ? p.entries : []).map(normalizeEntry).filter(Boolean).slice(0, MAX_ENTRIES);
    return { name: str(p.name).slice(0, MAX_NAME), entries };
}

function normalizeDoc(data) {
    const guilds = {};
    const srcGuilds = isObj(data && data.guilds) ? data.guilds : {};
    for (const [g, people] of Object.entries(srcGuilds)) {
        if (!isObj(people)) continue;
        const out = {};
        for (const [uid, p] of Object.entries(people)) {
            const person = normalizePerson(p);
            if (str(uid) && person) out[str(uid)] = person;
        }
        guilds[g] = out;
    }
    const hidden = {};
    const srcHidden = isObj(data && data.hidden) ? data.hidden : {};
    for (const [g, ids] of Object.entries(srcHidden)) {
        if (!isObj(ids)) continue;
        const out = {};
        for (const [id, h] of Object.entries(ids)) {
            if (str(id)) out[str(id)] = { by: str(h && h.by), at: Number(h && h.at) || 0 };
        }
        hidden[g] = out;
    }
    return { guilds, hidden };
}

const store = createJsonStore({
    file: settingsPath("user-notes.json"),
    defaults: () => ({ guilds: {}, hidden: {} }),
    normalize: normalizeDoc,
});

/** Tests point the store at a file of their own; null = the default again. */
function useFile(file) {
    store.useFile(file);
}

/** Whether an entry counts at `now`: not archived and not expired. */
function isActive(entry, now = Date.now()) {
    if (!entry || entry.archived) return false;
    return entry.expiresAt === null || entry.expiresAt > now;
}

/** Checks and normalises the fields of a new or changed entry; throws a 400 NoteError. */
function cleanFields(input, { partial = false } = {}) {
    const src = isObj(input) ? input : {};
    const out = {};
    if (!partial || src.level !== undefined) {
        if (!LEVELS.includes(str(src.level))) throw new NoteError(400, "bad_level", "Unbekannte Stufe.");
        out.level = str(src.level);
    }
    if (!partial || src.reason !== undefined) {
        if (!REASONS.includes(str(src.reason))) throw new NoteError(400, "bad_reason", "Unbekannter Grund.");
        out.reason = str(src.reason);
    }
    if (!partial || src.text !== undefined) {
        const text = str(src.text);
        if (text.length > MAX_TEXT) throw new NoteError(400, "text_too_long", `Die Notiz darf höchstens ${MAX_TEXT} Zeichen haben.`);
        out.text = text;
    }
    if (!partial || src.eventIds !== undefined) out.eventIds = normEventIds(src.eventIds);
    if (!partial || src.expiresAt !== undefined) {
        const raw = src.expiresAt;
        const exp = normExpires(raw);
        if (exp === null && raw !== null && raw !== undefined && raw !== "") throw new NoteError(400, "bad_expiry", "Ungültiges Ablaufdatum.");
        out.expiresAt = exp;
    }
    if (!partial || src.shared !== undefined) out.shared = src.shared === true;
    return out;
}

function personOf(doc, guildId, userId) {
    const g = doc.guilds[keyOf(guildId)];
    return g ? g[str(userId)] || null : null;
}

function findOwn(doc, guildId, userId, entryId) {
    const person = personOf(doc, guildId, userId);
    const entry = person ? person.entries.find((e) => e.id === str(entryId)) : null;
    if (!entry) throw new NoteError(404, "not_found", "Vermerk nicht gefunden.");
    return { person, entry };
}

/**
 * A new entry for `userId` on `guildId`. `name` = the display name now (kept
 * when the person already has entries and none is given). Returns the entry.
 */
function addEntry(guildId, userId, input, { by, byName, name, now = Date.now() } = {}) {
    const uid = str(userId);
    if (!uid) throw new NoteError(400, "bad_user", "Kein Discord-Konto angegeben.");
    const fields = cleanFields(input);
    const doc = store.read();
    const g = keyOf(guildId);
    doc.guilds[g] = doc.guilds[g] || {};
    const person = doc.guilds[g][uid] || { name: "", entries: [] };
    if (person.entries.length >= MAX_ENTRIES) throw new NoteError(400, "too_many", `Höchstens ${MAX_ENTRIES} Vermerke je Person.`);
    if (str(name)) person.name = str(name).slice(0, MAX_NAME);
    const entry = normalizeEntry({
        id: `n_${newId(6)}`,
        ...fields,
        by: str(by),
        byName: str(byName),
        at: now,
        history: [{ by: str(by), byName: str(byName), at: now, action: "create", changes: [] }],
    });
    person.entries.push(entry);
    doc.guilds[g][uid] = person;
    store.write(doc);
    return entry;
}

/** Changes an entry of `guildId`'s own (a shared one of another server: 404). Returns the entry. */
function updateEntry(guildId, userId, entryId, input, { by, byName, now = Date.now() } = {}) {
    const fields = cleanFields(input, { partial: true });
    const doc = store.read();
    const { entry } = findOwn(doc, guildId, userId, entryId);
    if (entry.archived) throw new NoteError(409, "archived", "Archivierte Vermerke ändern sich nicht mehr.");
    const changes = Object.keys(fields).filter((k) => JSON.stringify(entry[k]) !== JSON.stringify(fields[k]));
    if (!changes.length) return entry;
    Object.assign(entry, fields);
    entry.history.push({ by: str(by), byName: str(byName), at: now, action: "update", changes });
    entry.history = entry.history.slice(-MAX_HISTORY);
    store.write(doc);
    return entry;
}

/** Archives (`archived: true`) or restores an entry of `guildId`'s own. Returns the entry. */
function archiveEntry(guildId, userId, entryId, { archived = true, by, byName, now = Date.now() } = {}) {
    const doc = store.read();
    const { entry } = findOwn(doc, guildId, userId, entryId);
    if (!!entry.archived === !!archived) return entry;
    if (archived) {
        entry.archived = true;
        entry.archivedAt = now;
        entry.archivedBy = str(by);
    } else {
        delete entry.archived;
        delete entry.archivedAt;
        delete entry.archivedBy;
    }
    entry.history.push({ by: str(by), byName: str(byName), at: now, action: archived ? "archive" : "restore", changes: [] });
    entry.history = entry.history.slice(-MAX_HISTORY);
    store.write(doc);
    return entry;
}

/** Removes an entry for good (full admins only - the route checks). Returns true when it was there. */
function removeEntry(guildId, userId, entryId) {
    const doc = store.read();
    const { person } = findOwn(doc, guildId, userId, entryId);
    person.entries = person.entries.filter((e) => e.id !== str(entryId));
    const g = keyOf(guildId);
    if (!person.entries.length) delete doc.guilds[g][str(userId)];
    for (const ids of Object.values(doc.hidden)) delete ids[str(entryId)];
    store.write(doc);
    return true;
}

/** The shared entry `entryId` of another server than `guildId`: `{ originGuildId, userId, entry }` or null. */
function findShared(doc, guildId, entryId) {
    const own = keyOf(guildId);
    for (const [g, people] of Object.entries(doc.guilds)) {
        if (g === own) continue;
        for (const [uid, p] of Object.entries(people)) {
            const entry = p.entries.find((e) => e.id === str(entryId));
            if (entry) return entry.shared ? { originGuildId: g, userId: uid, entry } : null;
        }
    }
    return null;
}

/** Hides (`hidden: true`) or shows again a shared entry of another server on `guildId`. */
function hideShared(guildId, entryId, { hidden = true, by, now = Date.now() } = {}) {
    const doc = store.read();
    if (!findShared(doc, guildId, entryId)) throw new NoteError(404, "not_found", "Vermerk nicht gefunden.");
    const g = keyOf(guildId);
    doc.hidden[g] = doc.hidden[g] || {};
    if (hidden) doc.hidden[g][str(entryId)] = { by: str(by), at: now };
    else delete doc.hidden[g][str(entryId)];
    store.write(doc);
    return true;
}

/**
 * Every entry `guildId` sees, grouped per person: its own (`own: true`) and the
 * shared ones of other servers (`originGuildId`, `hidden` when it hid them).
 * `{ [userId]: { name, entries } }` - copies, the store keeps its own.
 */
function visibleOn(doc, guildId) {
    const own = keyOf(guildId);
    const hiddenHere = doc.hidden[own] || {};
    const out = {};
    const add = (uid, name, entry) => {
        out[uid] = out[uid] || { name: "", entries: [] };
        if (!out[uid].name && name) out[uid].name = name;
        out[uid].entries.push(entry);
    };
    for (const [uid, p] of Object.entries(doc.guilds[own] || {})) {
        out[uid] = { name: p.name, entries: [] };
        for (const e of p.entries) add(uid, p.name, { ...e, own: true, originGuildId: own, hidden: false });
    }
    for (const [g, people] of Object.entries(doc.guilds)) {
        if (g === own) continue;
        for (const [uid, p] of Object.entries(people)) {
            for (const e of p.entries) {
                if (e.shared) add(uid, p.name, { ...e, own: false, originGuildId: g, hidden: !!hiddenHere[e.id] });
            }
        }
    }
    for (const uid of Object.keys(out)) if (!out[uid].entries.length) delete out[uid];
    return out;
}

/** Every person with entries `guildId` sees (own and shared), see visibleOn. */
function listFor(guildId) {
    return visibleOn(store.read(), guildId);
}

/** The entries of one person `guildId` sees: `{ name, entries }`, empty when there are none. */
function personFor(guildId, userId) {
    return visibleOn(store.read(), guildId)[str(userId)] || { name: "", entries: [] };
}

/** The entries that count for `userId` on `guildId` at `now`: active and not hidden there. */
function activeEntries(guildId, userId, { now = Date.now() } = {}) {
    return personFor(guildId, userId).entries.filter((e) => !e.hidden && isActive(e, now));
}

/**
 * The counting entries of many persons at once with a single read of the file (the short form of a
 * whole raid, #979): `{ [userId]: entries }` - active, not hidden on `guildId`; persons without one
 * are left out.
 */
function activeEntriesMany(guildId, userIds, { now = Date.now() } = {}) {
    const visible = visibleOn(store.read(), guildId);
    const out = {};
    for (const uid of new Set((Array.isArray(userIds) ? userIds : []).map(str).filter(Boolean))) {
        const p = visible[uid];
        const entries = p ? p.entries.filter((e) => !e.hidden && isActive(e, now)) : [];
        if (entries.length) out[uid] = entries;
    }
    return out;
}

/** The highest active level of `userId` on `guildId` ("hint" < "warning" < "shadowban"), null when none counts. */
function activeLevelFor(guildId, userId, opts = {}) {
    let best = null;
    for (const e of activeEntries(guildId, userId, opts)) {
        if (best === null || levelRank(e.level) > levelRank(best)) best = e.level;
    }
    return best;
}

module.exports = {
    LEVELS, REASONS, MAX_TEXT, MAX_ENTRIES, MAX_EVENTS,
    NoteError, useFile, isActive, levelRank,
    addEntry, updateEntry, archiveEntry, removeEntry, hideShared,
    listFor, personFor, activeEntries, activeEntriesMany, activeLevelFor,
};
