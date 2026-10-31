// The raid overviews of the categories (services/events/overview/raidOverview.js):
// the messages `/createoverview` posted, found again by their message id.
//
// `data/settings/raid-overviews.json` = { overviews: [overview], scannedGuilds: [guildId] }
//
//   overview = { guildId, channelId, messageId, categoryId, hash, lastChange }
//            | { guildId, channelId, messageId, categoryId: "", scope: "server", hash, lastChange }
//
// `hash` fingerprints what the message shows (without the time), `lastChange` is
// when it was last redrawn (unix seconds, shown in its footer). Several
// overviews per category are fine - one per channel. An entry with
// `scope: "server"` lists every raid category of its server (`/createoverview
// scope:server`); at most one of those per channel, never mistaken for the
// overview of a category (no `scope` = a category's overview). `scannedGuilds` are the
// servers whose channels were searched once for overviews posted before
// the bot remembered them. Kept apart from the settings config: it changes on
// every redraw, and a save of the settings page must never race it.
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** Whether an entry is the overview of a whole server (not of one category). */
const isServerOverview = (o) => Boolean(o) && o.scope === "server";

/** A usable entry: a category's overview needs its category, a server's overview its server. */
const isComplete = (o) => Boolean(o && o.channelId && o.messageId && (isServerOverview(o) ? o.guildId : o.categoryId));

const store = createJsonStore({
    file: settingsPath("raid-overviews.json"),
    defaults: () => ({ overviews: [], scannedGuilds: [] }),
    normalize: (data) => ({
        overviews: Array.isArray(data && data.overviews) ? data.overviews.filter(isComplete) : [],
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
    const hit = store.read().overviews.find((o) => !isServerOverview(o) && o.channelId === str(channelId) && o.categoryId === str(categoryId));
    return hit ? { ...hit } : null;
}

/** The overview of every raid category of the server in a channel, or null. */
function findServerInChannel(channelId) {
    const hit = store.read().overviews.find((o) => isServerOverview(o) && o.channelId === str(channelId));
    return hit ? { ...hit } : null;
}

/** Remember an overview message (replaces the entry of the same message id) and return it. */
function setOverview(overview = {}) {
    const server = isServerOverview(overview);
    const entry = {
        guildId: str(overview.guildId),
        channelId: str(overview.channelId),
        messageId: str(overview.messageId),
        categoryId: server ? "" : str(overview.categoryId),
        ...(server ? { scope: "server" } : {}),
        hash: str(overview.hash),
        lastChange: Number(overview.lastChange) || 0,
    };
    if (!isComplete(entry)) return null;
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

module.exports = { listOverviews, getOverview, findInChannel, findServerInChannel, isServerOverview, setOverview, markDrawn, removeOverview, isScanned, markScanned, useFile };
