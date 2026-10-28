// Drawn images in bot messages (test feature, Oct 2026): a pure builder hands an
// SVG string, this turns it into a PNG and the PNG into a file of the message.
//
//   - render: @resvg/resvg-js with the bundled font only (assets/fonts/, Noto
//     Sans, OFL) - `loadSystemFonts: false`, so the small Linux server draws
//     exactly what a developer machine draws.
//   - cache: the last PNG per key (a message, an image of it) with the hash of
//     its SVG. The server has one vCPU: a redraw whose SVG did not change takes
//     the PNG from memory. The time a render took is logged at debug level.
//   - attach: a builder returns its payload with `images: [{ name, svg }]`
//     (each referenced as `attachment://<name>` by a media gallery or an embed
//     image); `withImages` swaps that for discord.js `files` plus `attachments: []`,
//     which on an edit drops the message's old files - an edit replaces the
//     picture instead of stacking a second one. A payload without images gets
//     `attachments: []` as well, so switching a picture off removes it.
//
// Which pictures are drawn at all is per server (#961): the server's own switch
// (serverSettings[guildId].discordVisuals), else the global default
// `config.discordVisuals` (configSchema.js) - `visualOn(config, key, guildId)`.
const crypto = require("crypto");
const { serverVisuals } = require("./serverSettings");
const { FONT_FILES, FONT_FAMILY } = require("../../utils/image/fontMetrics");
const logger = require("../../logger").child("discordImage");

/** How many PNGs stay in memory (one per message and image; the oldest goes first). */
const CACHE_MAX = 60;
const cache = new Map();

/**
 * Whether a drawn picture is switched on for the server a message is on (#961):
 * its own switch, else the global default (on unless set to false).
 */
function visualOn(config, key, guildId = "") {
    return serverVisuals(guildId, { config: config || {} })[key] !== false;
}

const hashOf = (svg) => crypto.createHash("sha1").update(String(svg)).digest("hex");

let Resvg = null;
function resvgClass() {
    if (!Resvg) Resvg = require("@resvg/resvg-js").Resvg;
    return Resvg;
}

/**
 * The PNG of an SVG, from the cache when `key` last rendered the same SVG. Throws when resvg cannot render.
 * @param {string} svg
 * @param {{ key?: string }} [o] what the cache keeps it under (a message and image name); none = no cache
 * @returns {Buffer}
 */
function renderPng(svg, { key = "" } = {}) {
    const hash = hashOf(svg);
    const hit = key ? cache.get(key) : null;
    if (hit && hit.hash === hash) return hit.png;
    const started = process.hrtime.bigint();
    const R = resvgClass();
    const png = new R(String(svg), {
        font: { fontFiles: [FONT_FILES.regular, FONT_FILES.bold], loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
        shapeRendering: 2,
        textRendering: 1,
    }).render().asPng();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logger.debug(`${key || "image"}: rendered in ${ms.toFixed(1)} ms (${png.length} bytes)`);
    if (key) {
        cache.delete(key);
        cache.set(key, { hash, png });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return png;
}

/**
 * A builder's payload ready for discord.js: `images` rendered into `files`, `attachments: []`
 * so an edit replaces the old files. Throws when an image cannot be rendered (the caller
 * then builds the message without pictures).
 * @param {object} payload with optional `images: [{ name, svg }]`
 * @param {{ key?: string }} [o] the message's cache key ("overview:<messageId>", "setup:<eventId>")
 */
function withImages(payload, { key = "" } = {}) {
    const { images, ...rest } = payload || {};
    const files = (images || []).map((img) => ({
        attachment: renderPng(img.svg, { key: key ? `${key}:${img.name}` : "" }),
        name: img.name,
    }));
    return { ...rest, files, attachments: [] };
}

/** Empty the PNG cache (tests). */
function clearImageCache() {
    cache.clear();
}

module.exports = { visualOn, renderPng, withImages, clearImageCache, CACHE_MAX };
