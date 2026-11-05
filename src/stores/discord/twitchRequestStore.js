// The requests of raiders to be announced on Twitch (docs/twitch.md), one record per
// server and Discord account, so "at most one open request per server" holds by shape.
// Not in the config: a raider's write must not compete with a settings save. The list the
// job announces stays serverSettings[guildId].twitchStreamers, this file only says who asked.
//
//   "<guildId>:<userId>": { guildId, userId, userName, login, status, requestedAt, decidedAt }
//
// status: "pending" | "approved" | "rejected". Personal data (docs/data-storage.md).
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const store = createJsonStore({
    file: settingsPath("twitch-requests.json"),
    defaults: () => ({}),
    normalize: (data) => (data && typeof data === "object" && !Array.isArray(data) ? data : {}),
});

const keyOf = (guildId, userId) => `${guildId}:${userId}`;

function allRequests() {
    return Object.values(store.read());
}

/** The caller's record on one server, or null. */
function requestOf(guildId, userId) {
    return store.read()[keyOf(guildId, userId)] || null;
}

/** All records of one account, on every server. */
function requestsOfUser(userId) {
    return allRequests().filter((r) => r.userId === userId);
}

/** All records of one server. */
function requestsOfGuild(guildId) {
    return allRequests().filter((r) => r.guildId === guildId);
}

/** Store one record: it replaces what this account had on this server. */
function putRequest(record) {
    const data = store.read();
    data[keyOf(record.guildId, record.userId)] = record;
    store.write(data);
    return record;
}

/** Remove one record; false when there was none. */
function removeRequest(guildId, userId) {
    const data = store.read();
    const key = keyOf(guildId, userId);
    if (!data[key]) return false;
    delete data[key];
    store.write(data);
    return true;
}

module.exports = {
    requestOf,
    requestsOfUser,
    requestsOfGuild,
    putRequest,
    removeRequest,
    useFile: store.useFile,
};
