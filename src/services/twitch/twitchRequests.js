// Raiders ask to be announced on Twitch, the orga decides (docs/twitch.md, "Raider requests").
//
// The orga's list stays the one source: an approval adds a normal entry with
// `source: "raider"`, a record here only says who asked for what. So "approved" is
// believed only while such an entry of that login is still in the list: an entry the orga
// removed or replaced by its own shows as no entry at all, and only the person of an
// approved record can ever take a raider's entry off the list by themselves.
//
// Who asks and on which server they may ask is the route's check (session, membership).
const store = require("../../stores/discord/twitchRequestStore");
const { getConfig, saveConfig } = require("../../stores/settings/settingsStore");
const { TwitchSettingsError, parseLogin, twitchStreamersOf } = require("./twitchSettings");

const NAME_LENGTH = 80;

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/** The entry of the list an approved record stands for, or null. */
function raiderEntryOf(record, config) {
    return twitchStreamersOf(record.guildId, { config })
        .find((e) => e.login === record.login && e.source === "raider") || null;
}

/** What a record means right now: "pending" | "approved" | "rejected" | "none". */
function statusOf(record, config = getConfig()) {
    if (!record) return "none";
    if (record.status !== "approved") return record.status;
    return raiderEntryOf(record, config) ? "approved" : "none";
}

/** The open requests of one server, oldest first; other servers' never show. */
function openRequests(guildId) {
    return store.requestsOfGuild(guildId)
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.requestedAt - b.requestedAt);
}

/** One open request of this server, or null. */
function openRequestOf(guildId, userId) {
    const record = store.requestOf(guildId, userId);
    return record && record.status === "pending" ? record : null;
}

/**
 * File the caller's request. An entry of the same login already in the list refuses
 * instead of counting as "approved": whoever typed a stranger's name must not be able to
 * take that entry off the list.
 * @throws {TwitchSettingsError} invalid_login | already_listed | already_open | already_approved
 */
function fileRequest({ guildId, userId, userName, login: rawLogin, config = getConfig(), now = Date.now() }) {
    const login = parseLogin(rawLogin);
    if (!login) throw new TwitchSettingsError("invalid_login", "Das ist kein gültiger Twitch-Name oder -Link.");
    const status = statusOf(store.requestOf(guildId, userId), config);
    if (status === "pending") throw new TwitchSettingsError("already_open", "Auf diesem Server wartet schon eine Anfrage von dir.");
    if (status === "approved") throw new TwitchSettingsError("already_approved", "Du stehst auf diesem Server schon in der Liste.");
    if (twitchStreamersOf(guildId, { config }).some((e) => e.login === login)) {
        throw new TwitchSettingsError("already_listed", `${login} steht auf diesem Server schon in der Liste.`);
    }
    return store.putRequest({
        guildId,
        userId,
        userName: str(userName).slice(0, NAME_LENGTH),
        login,
        status: "pending",
        requestedAt: now,
        decidedAt: 0,
    });
}

/** Withdraw one's own open request; false when there is none. */
function withdrawRequest(guildId, userId) {
    if (!openRequestOf(guildId, userId)) return false;
    return store.removeRequest(guildId, userId);
}

/** The orga said no; the raider may ask again at once. Null when nothing is open. */
function rejectRequest(guildId, userId, { now = Date.now() } = {}) {
    const record = openRequestOf(guildId, userId);
    return record ? store.putRequest({ ...record, status: "rejected", decidedAt: now }) : null;
}

/** Drop the approved records of a login: their entry is gone, or about to be someone else's. */
function forgetApproved(guildId, login, { exceptUserId = "" } = {}) {
    for (const record of store.requestsOfGuild(guildId)) {
        if (record.login === login && record.status === "approved" && record.userId !== exceptUserId) {
            store.removeRequest(guildId, record.userId);
        }
    }
}

/** The list has the entry now. An older owner of this login loses their claim on it. */
function markApproved(record, { now = Date.now() } = {}) {
    forgetApproved(record.guildId, record.login, { exceptUserId: record.userId });
    return store.putRequest({ ...record, status: "approved", decidedAt: now });
}

/**
 * Take one login off a server's list, for the orga and for the raider alike. A running
 * message is ended by the next check, which keeps its state as a tombstone until the
 * stream is over: put back in the same stream, nobody is pinged twice.
 * @returns {object} the config after saving
 */
function removeStreamer(guildId, login, { config = getConfig() } = {}) {
    const list = twitchStreamersOf(guildId, { config }).filter((e) => e.login !== login);
    const saved = saveConfig({ serverSettings: { [guildId]: { twitchStreamers: list } } });
    forgetApproved(guildId, login);
    return saved || config;
}

/** The raider takes their own entry off the list; false when they have none. */
function removeOwnEntry(guildId, userId, { config = getConfig() } = {}) {
    const record = store.requestOf(guildId, userId);
    if (statusOf(record, config) !== "approved") return false;
    removeStreamer(guildId, record.login, { config });
    return true;
}

module.exports = {
    statusOf,
    openRequests,
    openRequestOf,
    fileRequest,
    withdrawRequest,
    rejectRequest,
    markApproved,
    removeStreamer,
    removeOwnEntry,
};
