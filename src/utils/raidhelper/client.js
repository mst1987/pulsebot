const Raidhelper = require("../../classes/raidhelper");
const { getConfig } = require("../../stores/settingsStore");
const { readSnapshot } = require("../../stores/raidhelperEventsStore");
const budget = require("./budget");
const { raidhelperOf, activeRaidhelperGuilds } = require("./servers");

// The one place that builds Raid-Helper clients, so no caller deals with keys,
// server ids or the switch itself.
//
// Raid-Helper is set per Discord server (#927, utils/raidhelper/servers.js):
// `createRaidhelperClient({ guildId })` answers for that server — its key, its
// Raid-Helper server id, its budget, its synced list. A server whose
// Raid-Helper is off (or has no key) gets a client that asks raid-helper.xyz
// nothing. Reads answer "nothing there" — an empty event list, no raidplan —
// so every reader falls back to what is stored locally (raidEventStore's
// snapshots, the own events), exactly as it does during an outage. Writes
// (create an event, sign up, save a raid) are refused with a German reason,
// because pretending they worked would lose data.
//
// Without a guild id (callers that only know an event id): no active server =
// the switched-off client, one = that server's client, several = a client that
// asks each server's list and sends a single-event call to the server whose
// list holds the event.

const DISABLED_MESSAGE = "Raid-Helper ist für diesen Server nicht eingeschaltet (Einstellungen → Server → Raid-Helper).";

/**
 * Whether Raid-Helper is off: for one server (`guildId`), or — without one —
 * for every server.
 */
function raidhelperDisabled(config, guildId) {
    const cfg = config || getConfig();
    if (guildId !== undefined && guildId !== null && guildId !== "") return !raidhelperOf(guildId, cfg).active;
    return activeRaidhelperGuilds(cfg).length === 0;
}

function refuse() {
    const e = new Error(DISABLED_MESSAGE);
    e.code = "raidhelper_disabled";
    return Promise.reject(e);
}

/** A client with Raid-Helper's method names that never asks raid-helper.xyz. */
function disabledClient() {
    return {
        disabled: true,
        fetchEvents: async () => [],
        getAllEvents: async () => [],
        getPastEvents: async () => [],
        getTemplates: async () => [],
        getUserSignUps: async () => [],
        getMissingSignUps: async () => [],
        getSetup: async () => undefined,
        // A single event by id: "not found" rather than an error, so a caller
        // that checks `event.id` moves on to its local fallback.
        getEvent: async () => ({}),
        createEvent: refuse,
        signUpToRaid: refuse,
        signUp: refuse,
    };
}

// The event list comes from the sync job, never from a page (#608): Raid-Helper
// allows 1000 requests a day (budget.js), and pages that asked on every view
// used them up. Every list read of the default client answers from
// stores/raidhelperEventsStore.js, which services/events/raidhelperSync.js
// fills every few minutes (and on "Jetzt aktualisieren" in the settings).
// `{ live: true }` is for that job and for explicit admin actions only.
const SINGLE_CACHE_MS = 5 * 60 * 1000;
const NOT_SYNCED = "Raid-Helper-Events sind noch nicht abgeglichen (Einstellungen → Server → Raid-Helper → Jetzt aktualisieren).";

/** The synced events of one server that start at or after `sinceSeconds`, ascending; throws before its first sync. */
function snapshotEvents(guildId, sinceSeconds) {
    const snap = readSnapshot(guildId);
    if (!snap.syncedAt) throw new Error(snap.error ? `${NOT_SYNCED} Letzter Fehler: ${snap.error}` : NOT_SYNCED);
    return snap.events
        .filter((event) => Number(event.startTime) >= sinceSeconds)
        .sort((a, b) => a.startTime - b.startTime);
}

// Set by raidhelperSync.js: what runs after a successful write through a client.
let afterWrite = null;

/** Register what runs after a successful createEvent/signUp (the sync's quick refresh). */
function setAfterWrite(fn) {
    afterWrite = typeof fn === "function" ? fn : null;
}

function serverClient(guildId, config, live) {
    const rh = raidhelperOf(guildId, config);
    return new Raidhelper({
        serverId: rh.serverId,
        apiKey: rh.apiKey,
        budget: budget.forServer(rh.guildId),
        snapshot: live ? null : (since) => snapshotEvents(rh.guildId, since),
        cacheMs: SINGLE_CACHE_MS,
        onWrite: () => afterWrite && afterWrite(rh.guildId),
    });
}

const LIST_METHODS = ["fetchEvents", "getAllEvents", "getPastEvents", "getTemplates", "getUserSignUps", "getMissingSignUps"];
const BY_EVENT = ["getEvent", "getSetup", "fetchSetup", "signUp", "signUpToRaid"];

// The server whose synced list holds this event (first wins), else "".
function guildOfSyncedEvent(guilds, eventId) {
    const id = String(eventId || "");
    if (!id) return "";
    return guilds.find((g) => readSnapshot(g).events.some((e) => String(e.id) === id)) || "";
}

const found = (value) => value !== undefined && value !== null && !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);

/**
 * Several servers with Raid-Helper behind one client: list reads ask each and
 * join what came back (an error only when every server failed); a call about
 * one event goes to the server whose list holds it, else to each in turn until
 * one knows it; createEvent needs `data.guildId`.
 */
function multiClient(guilds, clients) {
    const out = { servers: guilds.slice() };
    for (const name of LIST_METHODS) {
        out[name] = async (...args) => {
            const results = await Promise.allSettled(clients.map((c) => c[name](...args)));
            const ok = results.filter((r) => r.status === "fulfilled");
            if (!ok.length) throw results[0].reason;
            return ok.flatMap((r) => (Array.isArray(r.value) ? r.value : []));
        };
    }
    for (const name of BY_EVENT) {
        out[name] = async (...args) => {
            const owner = guildOfSyncedEvent(guilds, args[0]);
            if (owner) return clients[guilds.indexOf(owner)][name](...args);
            let last;
            for (const client of clients) {
                last = await client[name](...args);
                if (found(last)) return last;
            }
            return last;
        };
    }
    out.createEvent = (data = {}) => {
        const { guildId, ...rest } = data || {};
        const index = guilds.indexOf(String(guildId || ""));
        if (index < 0) return refuse();
        return clients[index].createEvent(rest);
    };
    return out;
}

/**
 * The Raid-Helper client for one server (`guildId`), or — without one — for
 * every server with Raid-Helper switched on.
 */
function createRaidhelperClient({ live = false, guildId } = {}) {
    const config = getConfig();
    const wanted = guildId === undefined || guildId === null || guildId === "" ? null : String(guildId);
    const guilds = wanted ? (raidhelperOf(wanted, config).active ? [wanted] : []) : activeRaidhelperGuilds(config);
    if (!guilds.length) return disabledClient();
    // DEV ONLY (utils/raidhelper/fixture.js): a made-up Raid-Helper event for local test instances; never in production
    const fixture = require("./fixture");
    if (fixture.fixtureEnabled()) return fixture.fixtureClient();
    if (guilds.length === 1) {
        const client = serverClient(guilds[0], config, live);
        if (wanted || typeof client.createEvent !== "function") return client;
        // a caller that knows no server may still name one for a new event
        const createEvent = client.createEvent.bind(client);
        client.createEvent = (data = {}) => {
            const { guildId: target, ...rest } = data || {};
            if (target && String(target) !== guilds[0]) return refuse();
            return createEvent(rest);
        };
        return client;
    }
    return multiClient(guilds, guilds.map((g) => serverClient(g, config, live)));
}

module.exports = { createRaidhelperClient, raidhelperDisabled, setAfterWrite, DISABLED_MESSAGE, NOT_SYNCED };
