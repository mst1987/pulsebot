const crypto = require("crypto");
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { rulesFor, instanceById, compositionFor, DEFAULT_VERSION } = require("../config/gameVersions");

// Events the EventHelper keeps itself (`source: "eventhelper"`), next to the
// ones that live at Raid-Helper. One event has exactly one source: nothing here
// is ever a copy of a Raid-Helper event, and a Raid-Helper event is never
// imported into this file.
//
// Readers never touch this store directly — they go through eventSources.js,
// which hands out both sources in one shape (see docs/events.md, "Eigene Events").
//
// Stored under data/settings/events.json as { events: [...] }.
const EVENTS_FILE = settingsPath("events.json");
const store = createJsonStore({
    file: EVENTS_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.events) ? data.events : []),
});

// Own ids carry a prefix, so an id alone says which source it belongs to —
// Raid-Helper's are bare numbers.
const ID_PREFIX = "eh-";

const COMPOSITION_ROLES = ["tank", "healer", "melee", "ranged"];
const MAX_SIZE = 40;

// How long a raid takes (#305): a planning field like the size, inherited from
// the raid template. The rule itself lives in utils/time/index.js — several
// readers mock this store, and a pure calculation must not be mocked with it.
const { MIN_DURATION, MAX_DURATION, DEFAULT_DURATION, clampDuration, eventEndTime } = require("../utils/time");

// Colour and picture of the event message (#307) — a planning field like the
// duration, inherited from the raid template. The rules live in embedLook.js.
const { normalizeColor, normalizeImage, normalizeLook } = require("../services/events/embedLook");
// The emoji style of the event message: letter tiles and role icons (arcane unless chosen otherwise).
const { emojiStyleOf } = require("../services/discord/appEmojis");
const { str } = require("../utils/text");

function readAll() {
    return store.read();
}

function writeAll(events) {
    store.write({ events });
}

function newId() {
    return `${ID_PREFIX}${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

/** Whether an id names an own event (by its prefix; says nothing about existence). */
function isOwnEventId(id) {
    return String(id || "").startsWith(ID_PREFIX);
}

const int = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * A melee/ranged target as `{ min, max }`: a bare number is a minimum without
 * maximum (the shape before #261), `{ min, max }` the range the create dialog
 * and the raid templates use. null for "not given".
 */
function roleTarget(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    const num = (v) => (v === undefined || v === null || v === "" ? null : Math.floor(Number(v)));
    if (typeof raw === "object") return { min: num(raw.min), max: num(raw.max) };
    return { min: num(raw), max: null };
}

/**
 * Validate and complete the planning fields of an event: game version,
 * instances, size, composition and required buffs. Missing values come from
 * the rule set (config/gameVersions) — the largest default size of the chosen
 * instances, and their suggested tanks/healers at that size. Melee and ranged
 * stay 0 unless given: 0 means "no target", the damage dealers fill whatever
 * is left.
 *
 * Melee and ranged may be ranges (#261): `composition.melee` keeps the minimum
 * (every reader of a plain number keeps working), `compositionMax.melee` the
 * optional maximum (null = open). Minimums count against the size; a maximum
 * may neither exceed the size nor fall below its minimum.
 *
 * @returns {{ value?: object, error?: string }}
 */
function normalizePlan(input = {}) {
    const versionId = str(input.versionId) || DEFAULT_VERSION;
    const rules = rulesFor(versionId);
    if (!rules) return { error: `Unbekannte Spielversion „${versionId}“.` };

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
    const givenMax = input.compositionMax && typeof input.compositionMax === "object" ? input.compositionMax : {};
    const composition = {};
    const compositionMax = { melee: null, ranged: null };
    for (const role of COMPOSITION_ROLES) {
        const raw = given[role];
        const ranged = role === "melee" || role === "ranged";
        if (ranged && givenMax[role] !== undefined && givenMax[role] !== null && givenMax[role] !== "") {
            compositionMax[role] = Math.floor(Number(givenMax[role]));
        }
        if (raw === undefined || raw === null || raw === "") {
            composition[role] = role === "tank" ? suggested.tanks : (role === "healer" ? suggested.healers : 0);
            continue;
        }
        const target = ranged ? roleTarget(raw) : { min: Math.floor(Number(raw)), max: null };
        const n = target.min === null ? 0 : target.min;
        if (!Number.isFinite(n) || n < 0) return { error: "Die Zusammensetzung braucht Zahlen ab 0." };
        composition[role] = n;
        if (ranged && target.max !== null) compositionMax[role] = target.max;
    }
    const planned = COMPOSITION_ROLES.reduce((sum, r) => sum + composition[r], 0);
    if (planned > size) return { error: `Die Zusammensetzung (${planned}) ist größer als der Raid (${size}).` };
    for (const [role, label] of [["melee", "Nahkampf"], ["ranged", "Fernkampf"]]) {
        const max = compositionMax[role];
        if (max === null) continue;
        if (!Number.isFinite(max) || max < 0) return { error: `${label}: keine gültige Anzahl.` };
        if (max < composition[role]) return { error: `${label}: Minimum ist größer als Maximum.` };
        if (max > size) return { error: `${label}: Maximum ist größer als die Größe ${size}.` };
    }

    let durationMinutes = DEFAULT_DURATION;
    if (input.durationMinutes !== undefined && input.durationMinutes !== null && input.durationMinutes !== "") {
        durationMinutes = Math.floor(Number(input.durationMinutes));
        if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION || durationMinutes > MAX_DURATION) {
            return { error: `Die Dauer muss zwischen ${MIN_DURATION} und ${MAX_DURATION} Minuten liegen.` };
        }
    }

    const buffKeys = new Set([...rules.partyBuffs, ...rules.raidBuffs].map((b) => b.key));
    const rawBuffs = Array.isArray(input.requiredBuffs) ? input.requiredBuffs : [];
    const requiredBuffs = [...new Set(rawBuffs.map(str).filter(Boolean))];
    const unknownBuff = requiredBuffs.find((b) => !buffKeys.has(b));
    if (unknownBuff) return { error: `Buff „${unknownBuff}“ gibt es in ${rules.label} nicht.` };

    // The look of the event message (#307): an empty colour or picture is a
    // value of its own — then the rule set of the instances decides.
    const look = normalizeLook(input);
    if (look.error) return { error: look.error };

    return { value: { versionId, instanceIds, size, composition, compositionMax, requiredBuffs, durationMinutes, ...look.value } };
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
        // The voice channel the raid meets in (#305): shown on the signup
        // message and used as the place of the Discord event. "" = none.
        voiceChannelId: e.voiceChannelId || "",
        title: e.title || "",
        description: e.description || "",
        leaderId: e.leaderId || "",
        startTime: Number(e.startTime) || 0,
        versionId: e.versionId || DEFAULT_VERSION,
        instanceIds: Array.isArray(e.instanceIds) ? e.instanceIds : [],
        size: Number(e.size) || 0,
        composition: { tank: 0, healer: 0, melee: 0, ranged: 0, ...(e.composition || {}) },
        // Optional maxima of the melee/ranged targets (#261), null = open.
        compositionMax: { melee: null, ranged: null, ...(e.compositionMax || {}) },
        requiredBuffs: Array.isArray(e.requiredBuffs) ? e.requiredBuffs : [],
        // How long the raid is planned for (#305); an event stored before it
        // reads as the default. Its end is startTime + durationMinutes * 60.
        durationMinutes: clampDuration(e.durationMinutes),
        // How the event message looks (#307), inherited from the raid template:
        // "" resp. an empty url = the rule set of the instances decides.
        color: normalizeColor(e.color),
        image: normalizeImage(e.image),
        // The letter tiles and role icons of the event message; an event from before has the default.
        emojiStyle: emojiStyleOf(e.emojiStyle),
        // The raid template the event started from ("" = none). The event keeps
        // its own copy of the values; nothing here ever writes to the template.
        raidTemplateId: e.raidTemplateId || "",
        signupDeadline: Number(e.signupDeadline) || 0,
        fairness: !!e.fairness,
        wishes: !!e.wishes,
        // "Vorschlag automatisch bei Anmeldeschluss" (#261); read by the setup suggestion (#262).
        autoSuggest: !!e.autoSuggest,
        // What happens to a new "Dabei" once the raid is full (#306): "bench"
        // puts it on the waiting list, "off" refuses the signup. Default "bench".
        overflow: e.overflow === "off" ? "off" : "bench",
        // Close the signup by itself the moment the raid is full (#306). Signing
        // off never opens it again — that stays the orga's call.
        lockAtLimit: !!e.lockAtLimit,
        // When the "Beim Anlegen ankündigen" ping went out (#306), 0 = never —
        // it is what keeps the announcement from going a second time.
        announcedAt: Number(e.announcedAt) || 0,
        // The setup: null, a draft (the editor's, or the automatic proposal at the
        // signup deadline via saveSetupDraft), its approval and the last approved
        // snapshot — one shape, see setupEditor.js (#263).
        setup: e.setup || null,
        message: e.message && e.message.messageId
            ? { channelId: e.message.channelId || "", messageId: e.message.messageId, ...(e.message.hash ? { hash: e.message.hash } : {}) }
            : null,
        // The approved setup posted into the channel and its DMs (#290, setupMessage.js).
        setupPost: e.setupPost && typeof e.setupPost === "object" ? e.setupPost : null,
        // The text "Ping everyone" sends, and what the first post of the setup
        // pings with by itself (#354's follow-up); "" = setupPing.js's default.
        setupPingText: String(e.setupPingText || ""),
        // Raiders the orga marked as an extra tank / extra healer — they play another role
        // on some bosses (a third tank, a healer who is DPS on most). `{ userId: ["tank", "healer"] }`;
        // no part of the setup, so a new proposal keeps it. The raid plan reads it.
        extraRoles: cleanExtraRoles(e.extraRoles),
        // The Discord event (guild scheduled event) that belongs to this one
        // (#305, discordEvent.js): `{ id, guildId, at, error }`, null for none.
        discordEvent: e.discordEvent && typeof e.discordEvent === "object" ? e.discordEvent : null,
        // Event verwalten (#288): "active" or "cancelled"; a closed signup takes
        // only sign-offs; the cancellation's reason; who did what, oldest first.
        status: e.status === "cancelled" ? "cancelled" : "active",
        signupsClosed: !!e.signupsClosed,
        cancel: e.cancel && typeof e.cancel === "object" ? {
            reason: String(e.cancel.reason || ""),
            at: Number(e.cancel.at) || 0,
            by: String(e.cancel.by || ""),
            byName: String(e.cancel.byName || ""),
            archived: !!e.cancel.archived,
        } : null,
        log: Array.isArray(e.log) ? e.log : [],
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
        voiceChannelId: str(input.voiceChannelId),
        title,
        description: String(input.description || ""),
        leaderId: str(input.leaderId),
        startTime,
        ...plan.value,
        signupDeadline,
        fairness: input.fairness === true,
        wishes: input.wishes === true,
        autoSuggest: input.autoSuggest === true,
        overflow: input.overflow === "off" ? "off" : "bench",
        lockAtLimit: input.lockAtLimit === true,
        emojiStyle: emojiStyleOf(input.emojiStyle),
        raidTemplateId: str(input.raidTemplateId),
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
    for (const key of ["title", "channelId", "channelName", "voiceChannelId", "categoryId", "categoryName", "leaderId", "raidTemplateId"]) {
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
    if (patch.autoSuggest !== undefined) next.autoSuggest = patch.autoSuggest === true;
    if (patch.overflow !== undefined) next.overflow = patch.overflow === "off" ? "off" : "bench";
    if (patch.lockAtLimit !== undefined) next.lockAtLimit = patch.lockAtLimit === true;
    if (patch.emojiStyle !== undefined) next.emojiStyle = emojiStyleOf(patch.emojiStyle);
    if (["versionId", "instanceIds", "size", "composition", "compositionMax", "requiredBuffs", "durationMinutes", "color", "image"].some((k) => patch[k] !== undefined)) {
        const pick = (key) => (patch[key] !== undefined ? patch[key] : current[key]);
        const plan = normalizePlan({
            versionId: pick("versionId"),
            instanceIds: pick("instanceIds"),
            size: pick("size"),
            composition: pick("composition"),
            // A new composition brings its own ranges; the stored maxima stay
            // only while the composition is not touched.
            compositionMax: patch.compositionMax !== undefined || patch.composition === undefined ? pick("compositionMax") : {},
            requiredBuffs: pick("requiredBuffs"),
            durationMinutes: pick("durationMinutes"),
            color: pick("color"),
            image: pick("image"),
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
        // `hash`: what the message shows (eventMessage.payloadHash) — the sweep redraws an outdated one.
        message: message && message.messageId
            ? { channelId: str(message.channelId), messageId: str(message.messageId), ...(message.hash ? { hash: str(message.hash) } : {}) }
            : null,
    };
    writeAll(events);
    return complete(events[idx]);
}

/**
 * Merge into the record of the posted setup (#290, setupMessage.js): where the
 * message sits, which version it shows, the DM run and who was told what.
 * Only the keys present change; `null` clears the whole record. Returns the
 * event or null.
 */
function setEventSetupPost(id, patch) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    const prev = events[idx].setupPost && typeof events[idx].setupPost === "object" ? events[idx].setupPost : {};
    events[idx] = { ...events[idx], setupPost: patch && typeof patch === "object" ? { ...prev, ...patch } : null };
    writeAll(events);
    return complete(events[idx]);
}

/** The roles a raider can be marked as an extra for. */
const EXTRA_ROLES = ["tank", "healer"];

/** `{ userId: [roles] }` with known roles only, in the order tank, healer; no empty entries. */
function cleanExtraRoles(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [userId, roles] of Object.entries(raw)) {
        const list = EXTRA_ROLES.filter((r) => Array.isArray(roles) && roles.includes(r));
        if (userId && list.length) out[userId] = list;
    }
    return out;
}

/**
 * Mark a raider as an extra tank / healer, or take the mark away.
 * @returns {object|null} the event, null for an unknown event or role
 */
function setEventExtraRole(id, userId, role, on) {
    if (!EXTRA_ROLES.includes(role) || !str(userId)) return null;
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    const all = cleanExtraRoles(events[idx].extraRoles);
    const now = new Set(all[str(userId)] || []);
    if (on) now.add(role); else now.delete(role);
    if (now.size) all[str(userId)] = [...now]; else delete all[str(userId)];
    events[idx] = { ...events[idx], extraRoles: cleanExtraRoles(all) };
    writeAll(events);
    return complete(events[idx]);
}

/** The text "Ping everyone" (setupPingBot.js) and the first post's own ping use, "" = the default. */
function setEventSetupPingText(id, text) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    events[idx] = { ...events[idx], setupPingText: String(text || "").trim().slice(0, 300) };
    writeAll(events);
    return complete(events[idx]);
}

/**
 * Merge into the record of the Discord event (#305, discordEvent.js):
 * `{ id, guildId, at, error }`. Only the keys present change; `null` clears the
 * whole record (the Discord event was deleted or never existed). Returns the
 * event or null. Apart from updateEvent() like setEventSetupPost(): this is no
 * planning field and must not re-validate the plan.
 */
function setEventDiscordEvent(id, patch) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    const prev = events[idx].discordEvent && typeof events[idx].discordEvent === "object" ? events[idx].discordEvent : {};
    events[idx] = { ...events[idx], discordEvent: patch && typeof patch === "object" ? { ...prev, ...patch } : null };
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

/**
 * Set the state fields of "Event verwalten" (#288) — status, signupsClosed,
 * cancel — without touching the plan. Only the keys present change. Returns
 * the event or null.
 */
function setEventState(id, patch = {}) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    const next = { ...events[idx] };
    if (patch.status !== undefined) next.status = patch.status === "cancelled" ? "cancelled" : "active";
    if (patch.signupsClosed !== undefined) next.signupsClosed = patch.signupsClosed === true;
    if (patch.cancel !== undefined) next.cancel = patch.cancel && typeof patch.cancel === "object" ? patch.cancel : null;
    next.updatedAt = Date.now();
    events[idx] = next;
    writeAll(events);
    return complete(next);
}

// The log keeps the newest entries only; an event is managed a handful of times.
const MAX_LOG = 100;

/**
 * Note who did what on an event (#288): `{ action, by, byName, detail, at }`,
 * appended; past MAX_LOG the oldest entries go. Returns the event or null.
 */
function appendEventLog(id, entry = {}) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    const row = {
        at: Number(entry.at) || Date.now(),
        action: str(entry.action),
        by: str(entry.by),
        byName: str(entry.byName),
        detail: String(entry.detail || "").trim().slice(0, 300),
    };
    const log = [...(Array.isArray(events[idx].log) ? events[idx].log : []), row].slice(-MAX_LOG);
    events[idx] = { ...events[idx], log };
    writeAll(events);
    return complete(events[idx]);
}

/**
 * Note that the "Beim Anlegen ankündigen" ping went out (#306). Written once:
 * a second call leaves the first moment in place, so no repost, retry or edit
 * can announce the same event twice. Returns the event or null.
 */
function setEventAnnounced(id, at = Date.now()) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return null;
    if (!Number(events[idx].announcedAt)) {
        events[idx] = { ...events[idx], announcedAt: Number(at) || Date.now() };
        writeAll(events);
    }
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

/**
 * Store a setup proposal (utils/setup/proposal.js) as a DRAFT that nobody
 * asked for in the editor — the automatic proposal at the signup deadline
 * (reminders.js). Stored in the setup editor's shape (setupEditor.js, #263):
 * `origin: "auto"` (the editor shows "automatischer Vorschlag"), the next
 * version, no options of its own. A draft is never shown to raiders and never
 * approved here — a human does that. It never replaces what the orga already
 * decided: an approved setup, or a draft changed after an approval.
 *
 * @returns {{ event?: object, error?: string, code?: "not_found" | "approved" }}
 */
function saveSetupDraft(id, proposal, { createdBy = "auto", now = Date.now() } = {}) {
    const events = readAll();
    const idx = events.findIndex((e) => e && e.id === str(id));
    if (idx < 0) return { error: "Event nicht gefunden.", code: "not_found" };
    const current = events[idx].setup;
    if (current && (current.status === "approved" || current.approved)) return { error: "Das Setup ist schon freigegeben.", code: "approved" };
    // eslint-disable-next-line no-unused-vars
    const { events: _perEvent, version: proposalVersion, ...rest } = proposal && typeof proposal === "object" ? proposal : {};
    events[idx] = {
        ...events[idx],
        setup: {
            ...rest,
            proposalVersion: proposalVersion || 0,
            status: "draft",
            version: ((current && current.version) || 0) + 1,
            origin: str(createdBy) === "auto" ? "auto" : "proposal",
            options: (current && current.options) || { weights: {}, fairness: null, wishes: null },
            approved: null,
            changedSinceApproval: false,
            approvedAt: 0,
            approvedBy: "",
            approvedVersion: 0,
            explanation: null,
            createdBy: str(createdBy),
            createdAt: now,
            updatedAt: now,
            updatedBy: str(createdBy),
        },
        updatedAt: now,
    };
    writeAll(events);
    return { event: complete(events[idx]) };
}

module.exports = {
    listEvents, getEvent, createEvent, updateEvent, setEventMessage, setEventSetup, deleteEvent, saveSetupDraft, setEventState,
    appendEventLog, setEventSetupPost, setEventSetupPingText, setEventExtraRole, EXTRA_ROLES, setEventDiscordEvent, setEventAnnounced,
    normalizePlan, isOwnEventId, useFile: store.useFile, eventEndTime, clampDuration, MIN_DURATION, MAX_DURATION,
    // only for the tests (#424): not part of the module's API
    _internal: {
        EVENTS_FILE,
    },
};
