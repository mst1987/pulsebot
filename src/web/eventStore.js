const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { rulesFor, instanceById, compositionFor, DEFAULT_VERSION } = require("../config/gameVersions");

// Events the EventHelper keeps itself (`source: "eventhelper"`), next to the
// ones that live at Raid-Helper. One event has exactly one source: nothing here
// is ever a copy of a Raid-Helper event, and a Raid-Helper event is never
// imported into this file.
//
// Readers never touch this store directly — they go through eventSources.js,
// which hands out both sources in one shape (see CLAUDE.md, "Eigene Events").
//
// Stored under data/settings/events.json as { events: [...] }.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const EVENTS_FILE = path.join(SETTINGS_DIR, "events.json");

// Own ids carry a prefix, so an id alone says which source it belongs to —
// Raid-Helper's are bare numbers.
const ID_PREFIX = "eh-";

const COMPOSITION_ROLES = ["tank", "healer", "melee", "ranged"];
const MAX_SIZE = 40;

function ensureDir() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
        return Array.isArray(data.events) ? data.events : [];
    } catch {
        return [];
    }
}

function writeAll(events) {
    ensureDir();
    fs.writeFileSync(EVENTS_FILE, JSON.stringify({ events }, null, 2));
}

function newId() {
    return `${ID_PREFIX}${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

/** Whether an id names an own event (by its prefix; says nothing about existence). */
function isOwnEventId(id) {
    return String(id || "").startsWith(ID_PREFIX);
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();
const int = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Validate and complete the planning fields of an event: game version,
 * instances, size and composition. Missing values come from the rule set
 * (config/gameVersions) — the largest default size of the chosen instances, and
 * their suggested tanks/healers at that size. Melee and ranged stay 0 unless
 * given: 0 means "no target", the damage dealers fill whatever is left.
 *
 * @returns {{ value?: object, error?: string }}
 */
function normalizePlan(input = {}) {
    const versionId = str(input.versionId) || DEFAULT_VERSION;
    if (!rulesFor(versionId)) return { error: `Unbekannte Spielversion „${versionId}“.` };

    const rawIds = Array.isArray(input.instanceIds) ? input.instanceIds : [];
    const instanceIds = [...new Set(rawIds.map(str).filter(Boolean))];
    const instances = [];
    for (const id of instanceIds) {
        const inst = instanceById(id);
        if (!inst) return { error: `Unbekannte Instanz „${id}“.` };
        if (inst.versionId !== versionId) return { error: `Die Instanz „${inst.name || id}“ gehört nicht zur gewählten Spielversion.` };
        instances.push(inst);
    }

    let size = int(input.size);
    if (input.size !== undefined && input.size !== null && input.size !== "" && !size) {
        return { error: "Die Raidgröße muss eine positive Zahl sein." };
    }
    if (size > MAX_SIZE) return { error: `Mehr als ${MAX_SIZE} Spieler passen in keinen Raid.` };
    if (!size) size = instances.length ? Math.max(...instances.map((i) => i.defaultSize || 0)) || 25 : 25;

    const given = input.composition && typeof input.composition === "object" ? input.composition : {};
    // The suggestion of the biggest instance of the night — the one the size came from.
    const biggest = instances.slice().sort((a, b) => (b.defaultSize || 0) - (a.defaultSize || 0))[0] || null;
    const suggested = compositionFor(biggest, size);
    const composition = {};
    for (const role of COMPOSITION_ROLES) {
        const raw = given[role];
        if (raw === undefined || raw === null || raw === "") {
            composition[role] = role === "tank" ? suggested.tanks : (role === "healer" ? suggested.healers : 0);
            continue;
        }
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n < 0) return { error: "Die Zusammensetzung braucht Zahlen ab 0." };
        composition[role] = n;
    }
    const planned = COMPOSITION_ROLES.reduce((sum, r) => sum + composition[r], 0);
    if (planned > size) return { error: `Die Zusammensetzung (${planned}) ist größer als der Raid (${size}).` };

    return { value: { versionId, instanceIds, size, composition } };
}

/** An event with every field present, as the store hands it out. */
function complete(e) {
    return {
        id: e.id,
        source: "eventhelper",
        guildId: e.guildId || "",
        categoryId: e.categoryId || "",
        categoryName: e.categoryName || "",
        channelId: e.channelId || "",
        channelName: e.channelName || "",
        title: e.title || "",
        description: e.description || "",
        leaderId: e.leaderId || "",
        startTime: Number(e.startTime) || 0,
        versionId: e.versionId || DEFAULT_VERSION,
        instanceIds: Array.isArray(e.instanceIds) ? e.instanceIds : [],
        size: Number(e.size) || 0,
        composition: { tank: 0, healer: 0, melee: 0, ranged: 0, ...(e.composition || {}) },
        signupDeadline: Number(e.signupDeadline) || 0,
        fairness: !!e.fairness,
        wishes: !!e.wishes,
        // The setup draft, its approval and the last approved snapshot (setupEditor.js, #263).
        setup: e.setup || null,
        message: e.message && e.message.messageId ? { channelId: e.message.channelId || "", messageId: e.message.messageId } : null,
        createdBy: e.createdBy || "",
        createdAt: Number(e.createdAt) || 0,
        updatedAt: Number(e.updatedAt) || 0,
    };
}

/**
 * The guild's own events, newest start first.
 * @param {string} guildId  "" = every guild
 * @param {{ sinceSeconds?: number, untilSeconds?: number }} [opts] start-time bounds, inclusive
 */
function listEvents(guildId, opts = {}) {
    const gid = str(guildId);
    const since = Number(opts.sinceSeconds) || 0;
    const until = Number(opts.untilSeconds) || 0;
    return readAll()
        .filter((e) => e && e.id && (!gid || e.guildId === gid))
        .filter((e) => (!since || (Number(e.startTime) || 0) >= since) && (!until || (Number(e.startTime) || 0) <= until))
        .map(complete)
        .sort((a, b) => b.startTime - a.startTime);
}

/** One own event by id, or null. */
function getEvent(id) {
    const key = str(id);
    if (!key) return null;
    const hit = readAll().find((e) => e && e.id === key);
    return hit ? complete(hit) : null;
}

/**
 * Create an event. Required: guildId, channelId, title, startTime (unix
 * seconds). The planning fields are completed from the rule set.
 * @returns {{ event?: object, error?: string }}
 */
function createEvent(input = {}) {
    const guildId = str(input.guildId);
    const channelId = str(input.channelId);
    const title = str(input.title);
    const startTime = int(input.startTime);
    if (!guildId) return { error: "Kein Discord-Server gewählt." };
    if (!channelId) return { error: "Kein Channel gewählt." };
    if (!title) return { error: "Das Event braucht einen Titel." };
    if (!startTime) return { error: "Ungültiger Termin." };
    const plan = normalizePlan(input);
    if (plan.error) return { error: plan.error };
    const signupDeadline = int(input.signupDeadline);
    if (signupDeadline && signupDeadline > startTime) return { error: "Der Anmeldeschluss liegt nach dem Raidbeginn." };

    const now = Date.now();
    const event = complete({
        id: newId(),
        guildId,
        categoryId: str(input.categoryId),
        categoryName: str(input.categoryName),
        channelId,
        channelName: str(input.channelName),
        title,
        description: String(input.description || ""),
        leaderId: str(input.leaderId),
        startTime,
        ...plan.value,
        signupDeadline,
        fairness: input.fairness === true,
        wishes: input.wishes === true,
        createdBy: str(input.createdBy),
        createdAt: now,
        updatedAt: now,
    });
    const events = readAll();
    events.push(event);
    writeAll(events);
    return { event };
}

/**
 * Change an event. Only the fields present in `patch` are touched; changing a
 * planning field re-validates the plan as a whole.
 * @returns {{ event?: object, error?: string }}
 */
function updateEvent(id, patch = {}) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return { error: "Event nicht gefunden." };
    const current = complete(events[idx]);
    const next = { ...current };
    for (const key of ["title", "channelId", "channelName", "categoryId", "categoryName", "leaderId"]) {
        if (patch[key] !== undefined) next[key] = str(patch[key]);
    }
    if (!next.title) return { error: "Das Event braucht einen Titel." };
    if (patch.description !== undefined) next.description = String(patch.description || "");
    if (patch.startTime !== undefined) {
        next.startTime = int(patch.startTime);
        if (!next.startTime) return { error: "Ungültiger Termin." };
    }
    if (patch.signupDeadline !== undefined) next.signupDeadline = int(patch.signupDeadline);
    if (next.signupDeadline && next.signupDeadline > next.startTime) return { error: "Der Anmeldeschluss liegt nach dem Raidbeginn." };
    if (patch.fairness !== undefined) next.fairness = patch.fairness === true;
    if (patch.wishes !== undefined) next.wishes = patch.wishes === true;
    if (["versionId", "instanceIds", "size", "composition"].some((k) => patch[k] !== undefined)) {
        const plan = normalizePlan({
            versionId: patch.versionId !== undefined ? patch.versionId : current.versionId,
            instanceIds: patch.instanceIds !== undefined ? patch.instanceIds : current.instanceIds,
            size: patch.size !== undefined ? patch.size : current.size,
            composition: patch.composition !== undefined ? patch.composition : current.composition,
        });
        if (plan.error) return { error: plan.error };
        Object.assign(next, plan.value);
    }
    next.updatedAt = Date.now();
    events[idx] = next;
    writeAll(events);
    return { event: complete(next) };
}

/** Remember where the bot's event message sits (null clears it). Returns the event or null. */
function setEventMessage(id, message) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    events[idx] = {
        ...events[idx],
        message: message && message.messageId ? { channelId: str(message.channelId), messageId: str(message.messageId) } : null,
    };
    writeAll(events);
    return complete(events[idx]);
}

/**
 * Store the event's setup (#263) as setupEditor.js built it — draft, approval
 * and the last approved snapshot in one object (null clears it). Returns the
 * event or null. Apart from updateEvent() on purpose: the setup is no planning
 * field and must not re-validate the plan.
 */
function setEventSetup(id, setup) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    events[idx] = { ...events[idx], setup: setup && typeof setup === "object" ? setup : null };
    writeAll(events);
    return complete(events[idx]);
}

/** Delete an own event. Returns true when one was removed. */
function deleteEvent(id) {
    const events = readAll();
    const next = events.filter((e) => !(e && e.id === str(id)));
    if (next.length === events.length) return false;
    writeAll(next);
    return true;
}

module.exports = {
    listEvents, getEvent, createEvent, updateEvent, setEventMessage, setEventSetup, deleteEvent,
    normalizePlan, isOwnEventId, EVENTS_FILE, ID_PREFIX, COMPOSITION_ROLES,
};
