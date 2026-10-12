// The width of a text in the bundled font (assets/fonts/, Noto Sans), so an SVG
// drawn for Discord (utils/image/svg.js) can cut a long name before it runs out
// of its box: resvg draws text but cannot tell a builder how wide it came out.
//
// A small TrueType reader: the advance width of every character from the font's
// `cmap` (format 4 or 12) and `hmtx` tables, read once per weight. No kerning -
// a few pixels off on a long name, which the boxes leave room for.
const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "..", "..", "..", "assets", "fonts");
/** The two weights the images use; resvg gets exactly these files (loadSystemFonts off). */
const FONT_FILES = Object.freeze({
    regular: path.join(FONT_DIR, "NotoSans-Regular.ttf"),
    bold: path.join(FONT_DIR, "NotoSans-Bold.ttf"),
});
const FONT_FAMILY = "Noto Sans";
/** Used for a character the font has no glyph for (an emoji in a name): about an "n". */
const FALLBACK_EM = 0.6;

/** The table directory of a TrueType file: tag -> offset. */
function tablesOf(buf) {
    const count = buf.readUInt16BE(4);
    const out = {};
    for (let i = 0; i < count; i++) {
        const at = 12 + i * 16;
        out[buf.toString("latin1", at, at + 4)] = buf.readUInt32BE(at + 8);
    }
    return out;
}

/** Codepoint -> glyph id from a cmap subtable of format 4 or 12. */
function readCmap(buf, cmapAt) {
    const count = buf.readUInt16BE(cmapAt + 2);
    const subtables = [];
    for (let i = 0; i < count; i++) {
        const at = cmapAt + 4 + i * 8;
        subtables.push({ platform: buf.readUInt16BE(at), encoding: buf.readUInt16BE(at + 2), offset: cmapAt + buf.readUInt32BE(at + 4) });
    }
    const map = new Map();
    const pick = subtables.find((s) => buf.readUInt16BE(s.offset) === 12) || subtables.find((s) => buf.readUInt16BE(s.offset) === 4);
    if (!pick) return map;
    const at = pick.offset;
    if (buf.readUInt16BE(at) === 12) {
        const groups = buf.readUInt32BE(at + 12);
        for (let g = 0; g < groups; g++) {
            const p = at + 16 + g * 12;
            const start = buf.readUInt32BE(p);
            const end = buf.readUInt32BE(p + 4);
            const glyph = buf.readUInt32BE(p + 8);
            for (let c = start; c <= end && c - start < 0x10000; c++) map.set(c, glyph + (c - start));
        }
        return map;
    }
    const segX2 = buf.readUInt16BE(at + 6);
    const ends = at + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
        const end = buf.readUInt16BE(ends + s * 2);
        const start = buf.readUInt16BE(starts + s * 2);
        const delta = buf.readInt16BE(deltas + s * 2);
        const rangeAt = ranges + s * 2;
        const range = buf.readUInt16BE(rangeAt);
        for (let c = start; c <= end && c !== 0xffff; c++) {
            let glyph;
            if (!range) glyph = (c + delta) & 0xffff;
            else {
                const g = buf.readUInt16BE(rangeAt + range + (c - start) * 2);
                glyph = g ? (g + delta) & 0xffff : 0;
            }
            if (glyph) map.set(c, glyph);
        }
    }
    return map;
}

/**
 * The metrics of one font file: `advance(codepoint)` in em (undefined without a glyph).
 * @param {Buffer} buf
 */
function parseFont(buf) {
    const tables = tablesOf(buf);
    if (tables.head === undefined || tables.hhea === undefined || tables.hmtx === undefined || tables.cmap === undefined) {
        throw new Error("not a TrueType font with head/hhea/hmtx/cmap");
    }
    const unitsPerEm = buf.readUInt16BE(tables.head + 18);
    const metrics = buf.readUInt16BE(tables.hhea + 34);
    const cmap = readCmap(buf, tables.cmap);
    const widthOf = (glyph) => buf.readUInt16BE(tables.hmtx + Math.min(glyph, metrics - 1) * 4);
    return {
        unitsPerEm,
        advance(codepoint) {
            const glyph = cmap.get(codepoint);
            return glyph === undefined ? undefined : widthOf(glyph) / unitsPerEm;
        },
    };
}

const loaded = {};

/** The metrics of a weight, read on first use. */
function fontOf(weight) {
    const key = weight === "bold" ? "bold" : "regular";
    if (!loaded[key]) loaded[key] = parseFont(fs.readFileSync(FONT_FILES[key]));
    return loaded[key];
}

/**
 * How wide `text` is drawn at `size` px.
 * @param {string} text
 * @param {number} size font size in px
 * @param {{ bold?: boolean, letterSpacing?: number }} [opts] letterSpacing in px, after every character
 */
function textWidth(text, size, { bold = false, letterSpacing = 0 } = {}) {
    const font = fontOf(bold ? "bold" : "regular");
    let em = 0;
    let count = 0;
    for (const ch of String(text || "")) {
        const a = font.advance(ch.codePointAt(0));
        em += a === undefined ? FALLBACK_EM : a;
        count += 1;
    }
    return em * size + count * letterSpacing;
}

/**
 * `text` cut so it fits `maxWidth` px, ending in "…" when it was cut ("" when not even that fits).
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} size
 * @param {{ bold?: boolean, letterSpacing?: number }} [opts]
 */
function fitText(text, maxWidth, size, opts = {}) {
    const value = String(text || "");
    if (textWidth(value, size, opts) <= maxWidth) return value;
    const chars = [...value];
    while (chars.length) {
        chars.pop();
        const cut = `${chars.join("").trimEnd()}…`;
        if (textWidth(cut, size, opts) <= maxWidth) return cut;
    }
    return "";
}

/**
 * The largest font size from `size` down to `minSize` (1 px steps) at which `text` fits
 * `maxWidth` px; `minSize` when even that is too wide (fitText cuts it then).
 */
function fitSize(text, maxWidth, size, minSize, opts = {}) {
    for (let s = size; s > minSize; s -= 1) {
        if (textWidth(text, s, opts) <= maxWidth) return s;
    }
    return minSize;
}

module.exports = { FONT_FILES, FONT_FAMILY, FONT_DIR, parseFont, textWidth, fitText, fitSize };
