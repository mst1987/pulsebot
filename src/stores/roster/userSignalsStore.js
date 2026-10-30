// The hints from the data for the Vermerke (docs/vermerke.md, #982): what the
// bot noticed about a Discord account - a sign-off after the setup was out, a
// sign-off shortly before the start, leaving the server. The bot never makes a
// note of it: services/vermerke/userSignals.js turns these events into
// proposals the orga decides on. Sensitive (restore.SENSITIVE_FILES), kept for
// RETENTION_DAYS, per server.
//
// `data/settings/user-signals.json` =
//   { guilds:  { [guildId]: { [userId]: { name, events: [event] } } },
//     ignored: { [guildId]: { [userId]: { [kind]: at } } } }
//
//   event    { kind, eventId, title, startTime, at, hoursBefore?, byOrga? }
//            kind one of KINDS; eventId/title/startTime (seconds) of the raid
//            ("" / 0 for leaving the server); at = when it happened (ms);
//            hoursBefore = hours from the sign-off to the start; byOrga = the
//            orga entered the sign-off
//   ignored  "Ausblenden" of the orga: a kind of a person counts again only with
//            an event after `at` (IGNORE_KINDS - no_show is computed, but may
//            be ignored all the same)
//
// Only the bot writes events (services/vermerke/signalRecorder.js); nothing
// here ever reaches the person (test/services/vermerke/vermerkeNeverToPerson.test.js).
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

/** The kinds stored as events (no_show is computed from the attendance overrides). */
const KINDS = ["signoff_after_setup", "late_signoff", "left_server"];
/** Every kind of hint - the ones the orga may ignore. */
const IGNORE_KINDS = ["signoff_after_setup", "late_signoff", "no_show", "left_early", "left_server"];
const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 60;
const NAME_MAX = 80;
const TITLE_MAX = 100;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** One stored event, or null when it is not one. */
function cleanEvent(e) {
    if (!isObject(e) || !KINDS.includes(str(e.kind))) return null;
    const at = Number(e.at) || 0;
    if (!at) return null;
    const out = {
        kind: str(e.kind),
        eventId: str(e.eventId),
        title: str(e.title).slice(0, TITLE_MAX),
        startTime: Number(e.startTime) || 0,
        at,
    };
    if (Number.isFinite(Number(e.hoursBefore)) && e.hoursBefore !== null && e.hoursBefore !== undefined) {
        out.hoursBefore = Math.max(0, Math.round(Number(e.hoursBefore) * 10) / 10);
    }
    if (e.byOrga === true) out.byOrga = true;
    return out;
}

function normalize(data) {
    const guilds = {};
    for (const [guildId, people] of Object.entries(isObject(data && data.guilds) ? data.guilds : {})) {
        if (!str(guildId) || !isObject(people)) continue;
        const block = {};
        for (const [userId, p] of Object.entries(people)) {
            if (!str(userId) || !isObject(p)) continue;
            const events = (Array.isArray(p.events) ? p.events : []).map(cleanEvent).filter(Boolean);
            if (events.length) block[str(userId)] = { name: str(p.name).slice(0, NAME_MAX), events };
        }
        if (Object.keys(block).length) guilds[str(guildId)] = block;
    }
    const ignored = {};
    for (const [guildId, people] of Object.entries(isObject(data && data.ignored) ? data.ignored : {})) {
        if (!str(guildId) || !isObject(people)) continue;
        const block = {};
        for (const [userId, kinds] of Object.entries(people)) {
            if (!str(userId) || !isObject(kinds)) continue;
            const clean = {};
            for (const [kind, at] of Object.entries(kinds)) if (IGNORE_KINDS.includes(kind) && Number(at) > 0) clean[kind] = Number(at);
            if (Object.keys(clean).length) block[str(userId)] = clean;
        }
        if (Object.keys(block).length) ignored[str(guildId)] = block;
    }
    return { guilds, ignored };
}

const store = createJsonStore({
    file: settingsPath("user-signals.json"),
    defaults: () => ({ guilds: {}, ignored: {} }),
    normalize,
    cache: true,
});

/** Tests point the store at a file of their own; null = the default again. */
function useFile(file) {
    store.useFile(file);
    lastPruneAt = 0;
}

const fresh = (now) => (e) => e.at >= now - RETENTION_DAYS * DAY_MS;

/** Drops what is older than RETENTION_DAYS, and persons left without anything. */
function prune(doc, now) {
    for (const [guildId, people] of Object.entries(doc.guilds)) {
        for (const [userId, p] of Object.entries(people)) {
            p.events = p.events.filter(fresh(now));
            if (!p.events.length) delete people[userId];
        }
        if (!Object.keys(people).length) delete doc.guilds[guildId];
    }
    const cut = now - RETENTION_DAYS * DAY_MS;
    for (const [guildId, people] of Object.entries(doc.ignored)) {
        for (const [userId, kinds] of Object.entries(people)) {
            for (const [kind, at] of Object.entries(kinds)) if (at < cut) delete kinds[kind];
            if (!Object.keys(kinds).length) delete people[userId];
        }
        if (!Object.keys(people).length) delete doc.ignored[guildId];
    }
    return doc;
}

/**
 * Records one event of `userId` on `guildId`. The same kind for the same raid counts once (signing
 * off, back on and off again is one sign-off - the first one is kept). Returns the stored event, or
 * null when it was none or already there.
 */
function recordEvent(guildId, userId, event, { name = "", now = Date.now() } = {}) {
    const gid = str(guildId);
    const uid = str(userId);
    const clean = cleanEvent({ ...event, at: (event && event.at) || now });
    if (!gid || !uid || !clean) return null;
    // already there: nothing to write (a sign-off noted again on every save would rewrite the file)
    const known = ((store.peek().guilds[gid] || {})[uid] || { events: [] }).events;
    if (clean.eventId && known.some((e) => e.kind === clean.kind && e.eventId === clean.eventId)) return null;
    let stored = null;
    store.update((doc) => {
        prune(doc, now);
        const people = doc.guilds[gid] || (doc.guilds[gid] = {});
        const person = people[uid] || (people[uid] = { name: "", events: [] });
        if (str(name)) person.name = str(name).slice(0, NAME_MAX);
        if (clean.eventId && person.events.some((e) => e.kind === clean.kind && e.eventId === clean.eventId)) return doc;
        person.events.push(clean);
        person.events = person.events.sort((a, b) => a.at - b.at).slice(-MAX_EVENTS);
        stored = clean;
        return doc;
    });
    return stored;
}

// When the reading side last dropped what is past RETENTION_DAYS (once a day at most, see pruneDaily).
let lastPruneAt = 0;

/** Whether `doc` holds anything past the retention (a cheap look, no copy). */
function hasStale(doc, now) {
    const cut = now - RETENTION_DAYS * DAY_MS;
    for (const people of Object.values(doc.guilds)) {
        for (const p of Object.values(people)) if (p.events.some((e) => e.at < cut)) return true;
    }
    for (const people of Object.values(doc.ignored)) {
        for (const kinds of Object.values(people)) if (Object.values(kinds).some((at) => at < cut)) return true;
    }
    return false;
}

/**
 * Drops what is past RETENTION_DAYS also when nothing new is written (a quiet server keeps nothing
 * longer than that): at most once a day, and it writes only when there is something to drop.
 */
function pruneDaily(now = Date.now()) {
    if (now - lastPruneAt < DAY_MS) return false;
    lastPruneAt = now;
    if (!hasStale(store.peek(), now)) return false;
    store.update((doc) => prune(doc, now));
    return true;
}

/** Every person with events on `guildId` inside the retention: `{ [userId]: { name, events } }` (a copy). */
function eventsFor(guildId, { now = Date.now() } = {}) {
    pruneDaily(now);
    const people = store.peek().guilds[str(guildId)] || {};
    const out = {};
    for (const [userId, p] of Object.entries(people)) {
        const events = p.events.filter(fresh(now)).map((e) => ({ ...e }));
        if (events.length) out[userId] = { name: p.name, events };
    }
    return out;
}

/** "Ausblenden": `kind` of `userId` on `guildId` counts again only with an event after now. */
function ignore(guildId, userId, kind, { now = Date.now() } = {}) {
    const gid = str(guildId);
    const uid = str(userId);
    if (!gid || !uid || !IGNORE_KINDS.includes(str(kind))) return null;
    store.update((doc) => {
        prune(doc, now);
        const people = doc.ignored[gid] || (doc.ignored[gid] = {});
        const kinds = people[uid] || (people[uid] = {});
        kinds[str(kind)] = now;
        return doc;
    });
    return { userId: uid, kind: str(kind), at: now };
}

/** What the orga ignored on `guildId`: `{ [userId]: { [kind]: at } }` (a copy). */
function ignoredFor(guildId) {
    const people = store.peek().ignored[str(guildId)] || {};
    return Object.fromEntries(Object.entries(people).map(([uid, kinds]) => [uid, { ...kinds }]));
}

module.exports = {
    KINDS, IGNORE_KINDS, RETENTION_DAYS,
    useFile, recordEvent, eventsFor, ignore, ignoredFor, pruneDaily,
};
