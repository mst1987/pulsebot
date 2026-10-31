// The temporary voice channels of the raids (services/voice/tempVoiceJob.js):
// which channel the bot made for which event, so a restart finds them again.
//
// `data/settings/temp-voice.json` = { channels: { [eventId]: entry } }
//
//   entry = { guildId, channelId, name, createdAt, emptySince, closedAt, closeReason, manual, error }
//
// `createdAt`/`emptySince`/`closedAt` are unix seconds (0 = not yet / not now).
// `closeReason` says why the channel went: "empty", "limit" (the latest close
// after the end), "manual", "gone" (the event was deleted, cancelled or merged
// away), "missing" (someone deleted the channel in Discord). `manual` is set
// when the orga opened the channel by hand before its time. `error` is the last
// Discord refusal (create or delete), shown in the setup editor. A closed entry
// stays, so the job never opens the same raid's channel twice; entries of raids
// long over are dropped by `prune()`.
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** One entry in its stored form, or null when it names no server. */
function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = {
        guildId: str(raw.guildId),
        channelId: str(raw.channelId),
        name: str(raw.name),
        createdAt: num(raw.createdAt),
        emptySince: num(raw.emptySince),
        closedAt: num(raw.closedAt),
        closeReason: str(raw.closeReason),
        manual: raw.manual === true,
        error: str(raw.error).slice(0, 300),
    };
    return entry.guildId ? entry : null;
}

const store = createJsonStore({
    file: settingsPath("temp-voice.json"),
    defaults: () => ({ channels: {} }),
    normalize: (data) => {
        const channels = {};
        const raw = data && typeof data.channels === "object" && !Array.isArray(data.channels) ? data.channels : {};
        for (const [eventId, value] of Object.entries(raw)) {
            const entry = normalizeEntry(value);
            if (str(eventId) && entry) channels[str(eventId)] = entry;
        }
        return { channels };
    },
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/** The entry of one event, or null. */
function getEntry(eventId) {
    const hit = store.read().channels[str(eventId)];
    return hit ? { ...hit } : null;
}

/** Every entry: `[{ eventId, ...entry }]`. */
function listEntries() {
    return Object.entries(store.read().channels).map(([eventId, e]) => ({ eventId, ...e }));
}

/** Merge a change into an event's entry (made when missing) and return it; null without a server. */
function updateEntry(eventId, patch = {}) {
    const id = str(eventId);
    if (!id) return null;
    const data = store.read();
    const entry = normalizeEntry({ ...(data.channels[id] || {}), ...patch });
    if (!entry) return null;
    data.channels[id] = entry;
    store.write(data);
    return { ...entry };
}

/** Forget an event's entry. */
function removeEntry(eventId) {
    const data = store.read();
    if (!data.channels[str(eventId)]) return false;
    delete data.channels[str(eventId)];
    store.write(data);
    return true;
}

/** Drop closed entries older than `before` (unix seconds); returns how many went. */
function prune(before) {
    const data = store.read();
    let dropped = 0;
    for (const [id, e] of Object.entries(data.channels)) {
        if (e.closedAt && e.closedAt < before) {
            delete data.channels[id];
            dropped += 1;
        }
    }
    if (dropped) store.write(data);
    return dropped;
}

module.exports = { useFile, getEntry, listEntries, updateEntry, removeEntry, prune, normalizeEntry };
