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
// Raid-Helper list holds it, else the server its category belongs to.
// "" when none of that knows it.
//
// A raid still to be created is named by its category: the server comes from
// the bot's live channel cache first (a category made a minute ago is not in
// the stored snapshot yet), then from the series stored for it, then from the
// snapshot. Whatever stays unknown is foreign: only a full admin reaches it.
const eventStore = require("../../stores/events/eventStore");
const raidEventStore = require("../../stores/events/raidEventStore");
const raidhelperEventsStore = require("../../stores/events/raidhelperEventsStore");
const eventSeriesStore = require("../../stores/events/eventSeriesStore");
const { storedCategoryGuilds } = require("../discord/servers/serverOf");

const str = (value) => String(value === undefined || value === null ? "" : value).trim();

/** The server of the synced Raid-Helper list that holds `id`, "" when none does. */
function syncedListGuild(id) {
    for (const guildId of raidhelperEventsStore.snapshotGuilds()) {
        const list = raidhelperEventsStore.readSnapshot(guildId);
        if ((list.events || []).some((e) => e && str(e.id) === id)) return guildId;
    }
    return "";
}

/** The server of a Discord channel or category from the bot's live cache, "" when it does not see it. */
function liveGuildOf(channelId) {
    const id = str(channelId);
    if (!id) return "";
    try {
        // required here, not at the top: discord.js pulls in much of the bot
        const client = require("../discord/discord").getClient();
        const cache = client && client.channels && client.channels.cache;
        const channel = cache && typeof cache.get === "function" ? cache.get(id) : null;
        return channel ? str(channel.guildId || (channel.guild && channel.guild.id)) : "";
    } catch {
        return "";
    }
}

/** The server of a category: live, else its stored series' server, else the stored snapshot. */
function guildOfCategory(categoryId) {
    const id = str(categoryId);
    if (!id) return "";
    const live = liveGuildOf(id);
    if (live) return live;
    const series = eventSeriesStore.getSeries(id);
    if (series && str(series.guildId)) return str(series.guildId);
    return str(storedCategoryGuilds().get(id));
}

/** A raid's own `guildId`, else the server of its category (live first). */
function guildOfRaid(event) {
    if (!event) return "";
    return str(event.guildId) || guildOfCategory(event.categoryId);
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
        return guildOfCategory(entry.categoryId);
    }
    const id = str(entry);
    if (!id) return "";
    if (eventStore.isOwnEventId(id)) return guildOfRaid(eventStore.getEvent(id));
    return guildOfRaid(raidEventStore.getRaidEvent(id)) || syncedListGuild(id);
}

/** Whether an entry names anything at all (an id, or a row with an id or a category). */
function namesSomething(entry) {
    if (entry && typeof entry === "object") return !!(str(entry.id) || str(entry.categoryId));
    return !!str(entry);
}

/**
 * Whether every raid `entries` names may be reached from `guildId` (the
 * caller's active server). Fail closed (#925): a raid of another server and a
 * raid whose server nobody knows both refuse - only a full admin reaches those,
 * and the caller asks this for non-admins only. Entries that name nothing (an
 * empty id, a new raid without category) are skipped; the route checks the
 * channel it posts in itself. Nothing named passes. `guildId` may be a
 * function: it is then asked only once something is named.
 * @param {string|object|Array<string|object>} entries
 * @param {string|(() => string)} guildId
 */
function allOnServer(entries, guildId) {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(namesSomething);
    if (!list.length) return true;
    const active = str(typeof guildId === "function" ? guildId() : guildId);
    if (!active) return false;
    return list.every((entry) => serverOfEntry(entry) === active);
}

module.exports = { serverOfEntry, allOnServer, guildOfCategory, liveGuildOf };
