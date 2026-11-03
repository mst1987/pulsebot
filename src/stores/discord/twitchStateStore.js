// What the Twitch job knows about each server's streamer (docs/twitch.md).
//
// `data/settings/twitch-state.json` = { "<guildId>:<login>": record }. Kept out of
// the settings config on purpose: it changes on every run, and a PATCH of the
// settings page must never race it or bring an old message id back. It also has to
// survive a restart: an announced stream with the same streamId is never posted again.
//
// `display` holds what the last card showed, because the "ended" card is drawn when
// Twitch no longer answers for the stream and the entry may already be gone.
//
// A record with no `streamId` but an `error` is a stream that ended without ever getting
// its message: only the error is left to show, nothing was pinged yet.
//
// `pendingEnds` are older messages of this streamer whose "ended" edit still fails, each
// { messageId, channelId, display, startedAt, lastSeenAt, endFailingSince }: a new stream
// must not lose them, and a record may hold nothing else. `removedAt` marks a record whose
// entry was removed while its stream ran: it stays as a tombstone with the stream id until
// the stream is over, so putting the streamer back in the same stream does not ping again.

const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const EMPTY = Object.freeze({
    announced: false, // this stream got its message (and its ping)
    messageGone: false, // deleted in Discord: never post again for this stream
    messageId: "",
    channelId: "",
    streamId: "",
    startedAt: "",
    lastSeenAt: 0,
    endedAt: 0,
    endPending: false, // the "ended" edit failed, the next run tries again
    endFailingSince: 0, // the first failed try of that edit: 24 hours later the job gives up
    pendingEnds: [], // shared by every record of the default: replace it, never change it
    removedAt: 0, // the entry was removed at this time, the stream may still run
    lastEditAt: 0,
    hash: "",
    error: "",
    offlineCount: 0,
    lastOfflineAt: 0,
    display: null,
});

const store = createJsonStore({
    file: settingsPath("twitch-state.json"),
    defaults: () => ({}),
    normalize: (data) => (data && typeof data === "object" && !Array.isArray(data) ? data : {}),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const stateKey = (guildId, login) => `${guildId}:${login}`;

/** The record of one server's streamer, every field present. */
function getTwitchState(guildId, login) {
    const data = store.read();
    return { ...EMPTY, ...(data[stateKey(guildId, login)] || {}) };
}

/** Merge `patch` into the record and write it at once: a post is on record before anything else can fail. */
function setTwitchState(guildId, login, patch) {
    const data = store.read();
    const key = stateKey(guildId, login);
    const next = { ...EMPTY, ...(data[key] || {}), ...(patch || {}) };
    store.write({ ...data, [key]: next });
    return next;
}

function removeTwitchState(guildId, login) {
    const data = store.read();
    const key = stateKey(guildId, login);
    if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
    const next = { ...data };
    delete next[key];
    store.write(next);
    return true;
}

/** Every stored record as `{ guildId, login, state }`. */
function listTwitchStates() {
    const data = store.read();
    const out = [];
    for (const [key, value] of Object.entries(data)) {
        const cut = key.indexOf(":");
        if (cut <= 0) continue;
        out.push({ guildId: key.slice(0, cut), login: key.slice(cut + 1), state: { ...EMPTY, ...(value || {}) } });
    }
    return out;
}

module.exports = { getTwitchState, setTwitchState, removeTwitchState, listTwitchStates, useFile };
