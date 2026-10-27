// The Discord server a raid belongs to, looked up by its id (#925, epic #926).
//
// Rights hold per server: the orga of server B must not open, change or even
// see a raid of server A by sending its id. withUser (web/http/apiHandler.js)
// asks this for every event a route names (`orgaScoped`, `orgaRead`,
// `archived`) and answers 404 for a raid of another server - only a full admin
// (adminRoleIds, ADMIN_USER_ID, LOGCHECK_ADMIN_IDS) acts on every server.
//
// The server comes from the raid itself: an own event's `guildId`, a
// Raid-Helper snapshot's `guildId` (raid-events.json), the server whose synced
// Raid-Helper list holds it, else the server its category belongs to
// (serverOf.guildOfEvent). "" when none of that knows it.
const eventStore = require("../../stores/eventStore");
const raidEventStore = require("../../stores/raidEventStore");
const raidhelperEventsStore = require("../../stores/raidhelperEventsStore");
const { guildOfEvent } = require("../discord/serverOf");

const str = (value) => String(value === undefined || value === null ? "" : value).trim();

/** The server of the synced Raid-Helper list that holds `id`, "" when none does. */
function syncedListGuild(id) {
    for (const guildId of raidhelperEventsStore.snapshotGuilds()) {
        const list = raidhelperEventsStore.readSnapshot(guildId);
        if ((list.events || []).some((e) => e && str(e.id) === id)) return guildId;
    }
    return "";
}

/**
 * The server of what a route names: an event id, or a row (`{ id }`, or
 * `{ categoryId }` for a raid still to be created). "" when it is unknown.
 * @param {string|object} entry
 */
function serverOfEntry(entry) {
    if (entry && typeof entry === "object") {
        const id = str(entry.id);
        if (id) return serverOfEntry(id);
        return guildOfEvent({ categoryId: str(entry.categoryId) });
    }
    const id = str(entry);
    if (!id) return "";
    if (eventStore.isOwnEventId(id)) return guildOfEvent(eventStore.getEvent(id));
    const snapshot = raidEventStore.getRaidEvent(id);
    return guildOfEvent(snapshot) || syncedListGuild(id);
}

/**
 * Whether every raid `entries` names may be reached from `guildId` (the
 * caller's active server). A raid whose server is known and is another one
 * refuses; a raid whose server is unknown passes - the area rights of the
 * active server still apply to it. Without an active server only raids of no
 * known server pass. `guildId` may be a function: it is then asked only when
 * a named raid has a known server (the active server costs a lookup).
 * @param {string|object|Array<string|object>} entries
 * @param {string|(() => string)} guildId
 */
function allOnServer(entries, guildId) {
    const list = Array.isArray(entries) ? entries : [entries];
    const servers = list.map(serverOfEntry).filter(Boolean);
    if (!servers.length) return true;
    const active = str(typeof guildId === "function" ? guildId() : guildId);
    return !!active && servers.every((server) => server === active);
}

module.exports = { serverOfEntry, allOnServer };
