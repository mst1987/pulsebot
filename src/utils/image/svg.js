// Small pieces for the SVG images the bot draws for Discord (the week strip of
// the raid overview, the setup graphic): escaping, text, boxes and the shared
// dark palette. Pure string building - services/discord/discordImage.js turns
// the finished SVG into a PNG.
const { FONT_FAMILY, fitText } = require("./fontMetrics");

/** Discord's dark theme, the colours both images share. */
const PALETTE = Object.freeze({
    background: "#1a1b26",
    panel: "#232533",
    panelSoft: "#2b2e3f",
    line: "#353849",
    text: "#f2f3f5",
    muted: "#9aa0b4",
    green: "#3ad07a",
    orange: "#f0b232",
    grey: "#8e9297",
    purple: "#8e7cf0",
    red: "#ed4245",
});

// Characters XML 1.0 does not allow at all (resvg refuses the whole document otherwise).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/** A value safe inside SVG text and attributes. */
function esc(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(INVALID_XML, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** A number for an attribute: at most two decimals, no trailing zeros. */
const num = (n) => String(Math.round((Number(n) || 0) * 100) / 100);

/**
 * One line of text. `maxWidth` cuts it with "…" (measured in the bundled font).
 * @param {number} x
 * @param {number} y baseline
 * @param {string} value
 * @param {{ size?: number, bold?: boolean, fill?: string, anchor?: "start"|"middle"|"end",
 *   maxWidth?: number, letterSpacing?: number, opacity?: number }} [o]
 */
function text(x, y, value, { size = 16, bold = false, fill = PALETTE.text, anchor = "start", maxWidth = 0, letterSpacing = 0, opacity = 1 } = {}) {
    const shown = maxWidth > 0 ? fitText(value, maxWidth, size, { bold, letterSpacing }) : String(value || "");
    if (!shown) return "";
    const attrs = [
        `x="${num(x)}"`, `y="${num(y)}"`, `font-size="${num(size)}"`, `fill="${fill}"`,
        bold ? "font-weight=\"700\"" : "",
        anchor !== "start" ? `text-anchor="${anchor}"` : "",
        letterSpacing ? `letter-spacing="${num(letterSpacing)}"` : "",
        opacity !== 1 ? `opacity="${num(opacity)}"` : "",
    ].filter(Boolean).join(" ");
    return `<text ${attrs}>${esc(shown)}</text>`;
}

/** A rectangle, rounded by `r`; `stroke` draws a border inside the given box. */
function rect(x, y, w, h, { r = 0, fill = "none", stroke = "", strokeWidth = 0, opacity = 1 } = {}) {
    const inset = stroke && strokeWidth ? strokeWidth / 2 : 0;
    const attrs = [
        `x="${num(x + inset)}"`, `y="${num(y + inset)}"`, `width="${num(Math.max(0, w - 2 * inset))}"`, `height="${num(Math.max(0, h - 2 * inset))}"`,
        r ? `rx="${num(r)}"` : "", `fill="${fill}"`,
        stroke && strokeWidth ? `stroke="${stroke}" stroke-width="${num(strokeWidth)}"` : "",
        opacity !== 1 ? `opacity="${num(opacity)}"` : "",
    ].filter(Boolean).join(" ");
    return `<rect ${attrs}/>`;
}

/**
 * A raster image (a data URI) filling the box. `r` rounds its corners through a clip path, which
 * needs an `id` unique in the document.
 */
function image(href, x, y, w, h, { r = 0, id = "", opacity = 1 } = {}) {
    const box = `x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"`;
    const clip = r && id ? `<clipPath id="${esc(id)}"><rect ${box} rx="${num(r)}"/></clipPath>` : "";
    const attrs = [
        `href="${esc(href)}"`, box, "preserveAspectRatio=\"xMidYMid slice\"",
        clip ? `clip-path="url(#${esc(id)})"` : "",
        opacity !== 1 ? `opacity="${num(opacity)}"` : "",
    ].filter(Boolean).join(" ");
    return `${clip}<image ${attrs}/>`;
}

/** The whole document: size, background and the font every text uses. */
function svgDocument(width, height, body, { background = PALETTE.background } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" font-family="${FONT_FAMILY}">`
        + `${rect(0, 0, width, height, { fill: background })}${body}</svg>`;
}

module.exports = { PALETTE, esc, num, text, rect, image, svgDocument };
