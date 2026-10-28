// The cover image of a Discord event (guild scheduled event) — the raid's own
// picture: the event's own image if it has one, else the zone art of its
// leading instance (the picture the signup message shows with `raidArt`).
//
// Discord takes a cover as image data (`image` on create/edit), not as a link,
// so the picture is fetched here and handed over as a data URI. Rules:
//   * **https only**, a size limit and a timeout — a broken or hostile link
//     costs nothing but the cover.
//   * **Cached per URL in memory**, so a sync never fetches again.
//   * **Best-effort**: a failure answers `null` (a warning in the log), never
//     throws; the Discord event then simply has no cover.
//   * The cover is only sent when it changed: `discordEvent.coverKey` remembers
//     the URL that is on Discord, because every edit with an image is an upload.
//
// Switch: `eventCover` of the event's server (#961, serverVisuals: own switch, else
// the global `config.discordVisuals.eventCover`; on unless exactly `false`).
// Switched off sends no image on create; Discord has no way to remove a cover
// through the API short of uploading another, so an existing cover stays.
//
// Discord's recommended cover ratio is about 16:9; the zone art (600 x 300) is
// 2:1 and is cropped by Discord — fine for a cover.
const axios = require("axios");
const { serverVisuals } = require("./serverSettings");
const { lookOf, ruleSetLook } = require("../events/embedLook");

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const CACHE_LIMIT = 20;
const TYPES = { "image/jpeg": "image/jpeg", "image/png": "image/png", "image/gif": "image/gif", "image/webp": "image/webp" };

const cache = new Map();

/** Whether the cover is switched on for the event's server (#961: its own switch, else the global default; default on). */
function coverEnabled(config, guildId = "") {
    return !config || serverVisuals(guildId, { config }).eventCover !== false;
}

/** The https URL of an event's cover, "" when there is none. */
function coverUrlFor(event) {
    const own = lookOf(event).url;
    if (own) return own;
    return ruleSetLook((event || {}).instanceIds).art || "";
}

/** Fetch a picture as a data URI; null on any failure. Cached per URL. */
async function loadCover(url) {
    if (!/^https:\/\/[^/\s]+/i.test(String(url || ""))) return null;
    if (cache.has(url)) return cache.get(url);
    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer", timeout: TIMEOUT_MS, maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES,
        });
        const type = TYPES[String((res.headers || {})["content-type"] || "").split(";")[0].trim().toLowerCase()];
        const buf = Buffer.from(res.data);
        if (!type || !buf.length || buf.length > MAX_BYTES) throw new Error("not a usable picture");
        const uri = `data:${type};base64,${buf.toString("base64")}`;
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
        cache.set(url, uri);
        return uri;
    } catch (e) {
        console.warn(`[discordEventCover] Titelbild nicht geladen (${String(url).slice(0, 120)}): ${(e && e.message) || e}`);
        return null;
    }
}

/**
 * The cover to send with a create/edit: `{ key, image }`, or null when nothing
 * is to be sent (switched off, no picture, fetch failed, or `key` equals the
 * one already on Discord — pass it as `sentKey`).
 */
async function coverToSend(event, config, sentKey = "") {
    if (!coverEnabled(config, (event && event.guildId) || "")) return null;
    const url = coverUrlFor(event);
    if (!url || url === sentKey) return null;
    const image = await loadCover(url);
    return image ? { key: url, image } : null;
}

/** For the tests: forget the fetched pictures. */
function clearCache() {
    cache.clear();
}

module.exports = { coverEnabled, coverUrlFor, loadCover, coverToSend, clearCache, MAX_BYTES };
