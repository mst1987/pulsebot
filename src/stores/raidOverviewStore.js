// The raid overviews of the categories (services/events/raidOverview.js):
// the messages `/createoverview` posted, found again by their message id.
//
// `data/settings/raid-overviews.json` = { overviews: [overview], scannedGuilds: [guildId] }
//
//   overview = { guildId, channelId, messageId, categoryId, hash, lastChange }
//
// `hash` fingerprints what the message shows (without the time), `lastChange` is
// when it was last redrawn (unix seconds, shown in its footer). Several
// overviews per category are fine - one per channel. `scannedGuilds` are the
// servers whose channels were searched once for overviews posted before
// the bot remembered them. Kept apart from the settings config: it changes on
// every redraw, and a save of the settings page must never race it.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

const store = createJsonStore({
    file: settingsPath("raid-overviews.json"),
    defaults: () => ({ overviews: [], scannedGuilds: [] }),
    normalize: (data) => ({
        overviews: Array.isArray(data && data.overviews) ? data.overviews.filter((o) => o && o.channelId && o.messageId && o.categoryId) : [],
        scannedGuilds: Array.isArray(data && data.scannedGuilds) ? data.scannedGuilds.map(str).filter(Boolean) : [],
    }),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/** Every remembered overview message. */
function listOverviews() {
    return store.read().overviews.map((o) => ({ ...o }));
}

/** The overview with this message id, or null. */
function getOverview(messageId) {
    const hit = store.read().overviews.find((o) => o.messageId === str(messageId));
    return hit ? { ...hit } : null;
}

/** The overview of a category in a channel, or null. */
function findInChannel(channelId, categoryId) {
    const hit = store.read().overviews.find((o) => o.channelId === str(channelId) && o.categoryId === str(categoryId));
    return hit ? { ...hit } : null;
}

/** Remember an overview message (replaces the entry of the same message id) and return it. */
function setOverview(overview = {}) {
    const entry = {
        guildId: str(overview.guildId),
        channelId: str(overview.channelId),
        messageId: str(overview.messageId),
        categoryId: str(overview.categoryId),
        hash: str(overview.hash),
        lastChange: Number(overview.lastChange) || 0,
    };
    if (!entry.channelId || !entry.messageId || !entry.categoryId) return null;
    const data = store.read();
    data.overviews = [...data.overviews.filter((o) => o.messageId !== entry.messageId), entry];
    store.write(data);
    return { ...entry };
}

/** Note that a message now shows the content with this `hash`, drawn at `lastChange`; false for an unknown message. */
function markDrawn(messageId, hash, lastChange) {
    const data = store.read();
    const hit = data.overviews.find((o) => o.messageId === str(messageId));
    if (!hit) return false;
    hit.hash = str(hash);
    if (lastChange !== undefined) hit.lastChange = Number(lastChange) || 0;
    store.write(data);
    return true;
}

/** Forget a message; returns the removed overview or null. */
function removeOverview(messageId) {
    const data = store.read();
    const hit = data.overviews.find((o) => o.messageId === str(messageId));
    if (!hit) return null;
    data.overviews = data.overviews.filter((o) => o !== hit);
    store.write(data);
    return { ...hit };
}

/** Whether the old overviews of this server were searched already. */
function isScanned(guildId) {
    return store.read().scannedGuilds.includes(str(guildId));
}

/** Remember that a server's channels were searched. */
function markScanned(guildId) {
    const id = str(guildId);
    if (!id) return;
    const data = store.read();
    if (data.scannedGuilds.includes(id)) return;
    data.scannedGuilds.push(id);
    store.write(data);
}

module.exports = { listOverviews, getOverview, findInChannel, setOverview, markDrawn, removeOverview, isScanned, markScanned, useFile };
