// Where each event server's raid overview sits and what it showed last (#257, #361).
//
// `data/settings/talk-overview.json` = { [guildId]: { channelId, messageId,
// hash, postedAt, editedAt, checkedAt, error } } — one record per event server
// that has an overview target configured, since several can now post
// independently. Kept out of the settings config on purpose: it changes on
// every sync, and a PATCH of the settings page must never race it (or bring
// an old message id back).

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");


const EMPTY = { channelId: "", messageId: "", hash: "", postedAt: 0, editedAt: 0, checkedAt: 0, error: "" };

const store = createJsonStore({
    file: settingsPath("talk-overview.json"),
    defaults: () => ({}),
    normalize: (data) => (data && typeof data === "object" && !Array.isArray(data) ? data : {}),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

function readFile() {
    return store.read();
}

function writeFile(data) {
    store.write(data);
}

// The old shape (before several event servers existed) had these fields at
// the top level instead of nested per guild.
function isLegacyShape(data) {
    return typeof data.channelId === "string" || typeof data.messageId === "string";
}

/** The stored state for one event server; every field present, empty when nothing was posted yet. */
function getOverviewState(guildId) {
    const data = readFile();
    if (isLegacyShape(data)) {
        // Migrate once: the whole file was one message, so it becomes this
        // guild's record (there is only ever one entry to migrate into).
        const migrated = { [guildId]: { ...EMPTY, ...data } };
        writeFile(migrated);
        return migrated[guildId];
    }
    return { ...EMPTY, ...(data[guildId] || {}) };
}

/** Merge `patch` into one event server's stored state and return the result. */
function setOverviewState(guildId, patch) {
    const data = readFile();
    const base = isLegacyShape(data) ? {} : data;
    const next = { ...base, [guildId]: { ...EMPTY, ...(base[guildId] || {}), ...(patch || {}) } };
    writeFile(next);
    return next[guildId];
}

module.exports = { getOverviewState, setOverviewState, useFile };
