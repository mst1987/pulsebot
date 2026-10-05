const Raidhelper = require("../../classes/raidhelper");
const { getConfig } = require("../../stores/settingsStore");
const { readSnapshot } = require("../../stores/raidhelperEventsStore");

// Single place that knows about the admin-editable serverId override, so every
// call site gets it automatically without depending on stores/settingsStore itself.
//
// It is also the one switch that turns Raid-Helper off (#291, Einstellungen →
// Verbindungen → Raid-Helper, "Raid-Helper-Abfragen abschalten"): once
// `config.raidhelperRetirement.disabled` is set, every caller gets a client that
// asks raid-helper.xyz nothing. Reads answer "nothing there" — an empty event
// list, no raidplan — so every reader falls back to what is stored locally
// (raidEventStore's snapshots, the own events), exactly as it does during an
// outage. Writes (create an event, sign up, save a raid) are refused with a
// German reason, because pretending they worked would lose data.

const DISABLED_MESSAGE = "Raid-Helper ist abgeschaltet (Einstellungen → Verbindungen → Raid-Helper).";

/** Whether the Raid-Helper queries are switched off in this config. */
function raidhelperDisabled(config) {
    const cfg = config || getConfig();
    return !!(cfg && cfg.raidhelperRetirement && cfg.raidhelperRetirement.disabled);
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
const NOT_SYNCED = "Raid-Helper-Events sind noch nicht abgeglichen (Einstellungen → Verbindungen → Raid-Helper → Jetzt aktualisieren).";

/** The synced events that start at or after `sinceSeconds`, ascending; throws before the first sync. */
function snapshotEvents(sinceSeconds) {
    const snap = readSnapshot();
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

function createRaidhelperClient({ live = false } = {}) {
    const config = getConfig();
    if (raidhelperDisabled(config)) return disabledClient();
    // DEV ONLY (utils/raidhelper/fixture.js): a made-up Raid-Helper event for local test instances; never in production
    const fixture = require("./fixture");
    if (fixture.fixtureEnabled()) return fixture.fixtureClient();
    return new Raidhelper({
        serverId: config.raidhelperServerId,
        snapshot: live ? null : snapshotEvents,
        cacheMs: SINGLE_CACHE_MS,
        onWrite: () => afterWrite && afterWrite(),
    });
}

module.exports = { createRaidhelperClient, raidhelperDisabled, setAfterWrite, DISABLED_MESSAGE, NOT_SYNCED };
