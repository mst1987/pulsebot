// The "Orga-Zentrale" messages (services/events/orgaHub.js): one per raid
// category at most, posted by the orga into a channel only the orga sees.
//
// `data/settings/orga-hubs.json` = { hubs: [hub] }
//
//   hub = { categoryId, guildId, channelId, messageId, postedAt, postedBy, hash }
//
// `hash` is the fingerprint of what the message shows (orgaHub.payloadHash),
// so the sweep redraws only a hub whose content changed. Kept apart from the
// settings config like the talk overview's state: it changes on every redraw,
// and a save of the settings page must never race it.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const store = createJsonStore({
    file: settingsPath("orga-hubs.json"),
    defaults: () => ({ hubs: [] }),
    normalize: (data) => ({
        hubs: Array.isArray(data && data.hubs) ? data.hubs.filter((h) => h && h.categoryId && h.channelId && h.messageId) : [],
    }),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** Every posted hub, one per raid category at most. */
function listHubs() {
    return store.read().hubs.map((h) => ({ ...h }));
}

/** The hub of a category, or null. */
function getHub(categoryId) {
    const hit = store.read().hubs.find((h) => str(h.categoryId) === str(categoryId));
    return hit ? { ...hit } : null;
}

/** Remember a posted hub (replaces the category's earlier one) and return it. */
function setHub(hub = {}, { now = Date.now() } = {}) {
    const entry = {
        categoryId: str(hub.categoryId),
        guildId: str(hub.guildId),
        channelId: str(hub.channelId),
        messageId: str(hub.messageId),
        postedAt: Number(hub.postedAt) || now,
        postedBy: str(hub.postedBy),
        hash: str(hub.hash),
    };
    const data = store.read();
    data.hubs = [...data.hubs.filter((h) => str(h.categoryId) !== entry.categoryId), entry];
    store.write(data);
    return { ...entry };
}

/** Note that a category's hub now shows the content with this `hash`; false when there is no hub. */
function markHubDrawn(categoryId, hash) {
    const data = store.read();
    const hit = data.hubs.find((h) => str(h.categoryId) === str(categoryId));
    if (!hit) return false;
    hit.hash = str(hash);
    store.write(data);
    return true;
}

/** Forget a category's hub; returns the removed one or null. */
function removeHub(categoryId) {
    const data = store.read();
    const hit = data.hubs.find((h) => str(h.categoryId) === str(categoryId));
    if (!hit) return null;
    data.hubs = data.hubs.filter((h) => h !== hit);
    store.write(data);
    return { ...hit };
}

module.exports = { listHubs, getHub, setHub, markHubDrawn, removeHub, useFile };
