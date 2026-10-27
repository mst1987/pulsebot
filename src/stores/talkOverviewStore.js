// Where each link's raid list sits and what it showed last (#257, #361, #892).
//
// `data/settings/talk-overview.json` = { [key]: { channelId, messageId, hash,
// postedAt, editedAt, checkedAt, error } } — one record per link, keyed
// `from:to` since #892 (one message per link; a source with two links posts
// two lists). Before #892 the key was the source guild alone: such a record is
// moved to the first link of that source on its first read (`legacyKey`), so
// the message already in the channel keeps being edited instead of reposted.
// Kept out of the settings config on purpose: it changes on every sync, and a
// PATCH of the settings page must never race it (or bring an old message id
// back). A record whose link is gone (removed, or its source/target changed)
// is dropped by the full sync once its message is deleted (talkOverview.js
// pruneOrphans).

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

// The oldest shape (before several event servers existed) had these fields at
// the top level instead of nested per guild.
function isLegacyShape(data) {
    return typeof data.channelId === "string" || typeof data.messageId === "string";
}

/**
 * The stored state for one link (`from:to`); every field present, empty when
 * nothing was posted yet. `legacyKey` (the source guild id, only for the first
 * link of a source) names the pre-#892 record that becomes this one.
 */
function getOverviewState(key, { legacyKey = "" } = {}) {
    const data = readFile();
    if (isLegacyShape(data)) {
        // Migrate once: the whole file was one message, so it becomes this
        // link's record (there is only ever one entry to migrate into).
        const migrated = { [key]: { ...EMPTY, ...data } };
        writeFile(migrated);
        return migrated[key];
    }
    if (!data[key] && legacyKey && legacyKey !== key && data[legacyKey]) {
        const next = { ...data, [key]: { ...EMPTY, ...data[legacyKey] } };
        delete next[legacyKey];
        writeFile(next);
        return next[key];
    }
    return { ...EMPTY, ...(data[key] || {}) };
}

/**
 * The store key of every link, in link order: `{ link, key, legacyKey }` —
 * `legacyKey` is the source guild id on the first link of each source (the
 * one that inherits a pre-#892 record), "" on every further one.
 */
function overviewKeys(links) {
    const seen = new Set();
    const out = [];
    for (const link of Array.isArray(links) ? links : []) {
        const from = String((link && link.from) || "");
        const to = String((link && link.to) || "");
        if (!from || !to) continue;
        out.push({ link, key: `${from}:${to}`, legacyKey: seen.has(from) ? "" : from });
        seen.add(from);
    }
    return out;
}

/** Merge `patch` into one link's stored state and return the result. */
function setOverviewState(key, patch) {
    const data = readFile();
    const base = isLegacyShape(data) ? {} : data;
    const next = { ...base, [key]: { ...EMPTY, ...(base[key] || {}), ...(patch || {}) } };
    writeFile(next);
    return next[key];
}

/**
 * Every stored link key ("from:to"), for the clean-up of lists whose link is
 * gone. Leaves out what may still migrate onto a link: the oldest flat shape
 * (then nothing is listed) and a record keyed by the source guild alone.
 */
function listOverviewKeys() {
    const data = readFile();
    if (isLegacyShape(data)) return [];
    return Object.keys(data).filter((key) => /^[^:]+:[^:]+$/.test(key));
}

/** Drop one link's record (its message is gone or was deleted). */
function removeOverviewState(key) {
    const data = readFile();
    if (isLegacyShape(data) || !Object.prototype.hasOwnProperty.call(data, key)) return false;
    const next = { ...data };
    delete next[key];
    writeFile(next);
    return true;
}

module.exports = { getOverviewState, setOverviewState, overviewKeys, listOverviewKeys, removeOverviewState, useFile };
