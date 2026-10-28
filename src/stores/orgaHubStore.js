// The "Orga-Zentrale" messages (services/events/orgaHub.js): one per raid
// category at most, posted by the orga into a channel only the orga sees.
//
// `data/settings/orga-hubs.json` = { hubs: [hub], links: { [categoryId]: [{ label, url, emoji? }] } }
//
//   hub   = { categoryId, guildId, channelId, messageId, postedAt, postedBy, hash }
//   links = the link buttons below the hub's "Raid anlegen" row (WCL invite,
//           raid sheet ...), at most MAX_LINKS per category, checked like the
//           raider organizer's (availabilityStore.checkLinks); kept apart from
//           the hub so posting anew keeps them
//   features = { [categoryId]: { newRaid?, links?, summary? } } — the parts of the
//           hub that are switched off (#969): "Raid anlegen", the links ("Links …"
//           plus their row) and the status line; only `false` is stored, a
//           missing key means "on". The raid list always stays.
//
// `hash` is the fingerprint of what the message shows (orgaHub.payloadHash),
// so the sweep redraws only a hub whose content changed. Kept apart from the
// settings config like the talk overview's state: it changes on every redraw,
// and a save of the settings page must never race it.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { checkLinks, readLinks, readFeatures, mergeFeatures, MAX_LINKS, LINK_LABEL_MAX } = require("./availabilityStore");

/** The parts of the hub that can be switched off per category. */
const FEATURE_KEYS = ["newRaid", "links", "summary"];

const plainObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const store = createJsonStore({
    file: settingsPath("orga-hubs.json"),
    defaults: () => ({ hubs: [], links: {}, features: {} }),
    normalize: (data) => ({
        hubs: Array.isArray(data && data.hubs) ? data.hubs.filter((h) => h && h.categoryId && h.channelId && h.messageId) : [],
        links: plainObject(data && data.links),
        features: plainObject(data && data.features),
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

/** A category's orga links, in their order. */
function getLinks(categoryId) {
    const list = store.read().links[str(categoryId)];
    return Array.isArray(list) ? readLinks(list) : [];
}

/** Every category's orga links: `{ [categoryId]: [{ label, url }] }`. */
function listLinks() {
    const out = {};
    for (const categoryId of Object.keys(store.read().links)) {
        const list = getLinks(categoryId);
        if (list.length) out[categoryId] = list;
    }
    return out;
}

/**
 * Replace a category's orga links (checked by availabilityStore.checkLinks, plus: no
 * address twice); an empty list removes them. `{ links }` or `{ error }` (German).
 */
function setLinks(categoryId, list) {
    const cat = str(categoryId);
    if (!cat) return { error: "Keine Kategorie gewählt." };
    const checked = checkLinks(list);
    if (checked.error) return checked;
    const seen = new Set();
    for (const l of checked.value) {
        const key = l.url.toLowerCase();
        if (seen.has(key)) return { error: `Die Adresse von „${l.label}“ steht schon in der Liste.` };
        seen.add(key);
    }
    const data = store.read();
    if (checked.value.length) data.links[cat] = checked.value;
    else delete data.links[cat];
    store.write(data);
    return { links: checked.value.map((l) => ({ ...l })) };
}

/** A category's hub parts: `{ newRaid: true, links: true, summary: true }`, a missing key = on. */
function getFeatures(categoryId) {
    return readFeatures(store.read().features[str(categoryId)], FEATURE_KEYS);
}

/** Every category with at least one part switched off: `{ [categoryId]: { key: boolean } }`. */
function listFeatures() {
    const out = {};
    for (const categoryId of Object.keys(store.read().features)) out[categoryId] = getFeatures(categoryId);
    return out;
}

/** Switch parts of a category's hub (only the keys given change). `{ features }` or `{ error }` (German). */
function setFeatures(categoryId, input) {
    const data = store.read();
    const result = mergeFeatures(data.features, categoryId, input, FEATURE_KEYS);
    if (result.error) return result;
    store.write(data);
    return result;
}

module.exports = {
    MAX_LINKS, LINK_LABEL_MAX, FEATURE_KEYS, getLinks, listLinks, setLinks, getFeatures, listFeatures, setFeatures,
    listHubs, getHub, setHub, markHubDrawn, removeHub, useFile,
};
