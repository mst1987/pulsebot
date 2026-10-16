// The emoji of a link button (Raid hub / Orga-Zentrale links). Discord's link
// buttons are always grey, so the one thing an orga can set is an emoji before
// the label. Two kinds are allowed, both kept as text in the store:
//   - one unicode emoji ("📊", "🧙", with variation selector or ZWJ, a flag, a keycap)
//   - a custom Discord emoji in its message form "<:name:id>" / "<a:name:id>"
// `parseButtonEmoji` is the one pure check, `checkButtonEmoji` adds the German
// message the editors show.

const { ButtonBuilder, ButtonStyle } = require("discord.js");

const CUSTOM =/^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/;
const PICTO = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP = /^[0-9#*]️?⃣$/u;

/** The graphemes of `text` (falls back to code points where Intl.Segmenter is missing). */
function graphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
        return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
    }
    return [...text];
}

/**
 * Read the emoji text of a button.
 * @param {string} text
 * @returns {{ name: string } | { id: string, name: string, animated: boolean } | null} null = empty or not a single emoji
 */
function parseButtonEmoji(text) {
    const s = String(text === undefined || text === null ? "" : text).trim();
    if (!s) return null;
    const custom = CUSTOM.exec(s);
    if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === "a" };
    const parts = graphemes(s);
    if (parts.length !== 1) return null;
    const g = parts[0];
    if (PICTO.test(g) || FLAG.test(g) || KEYCAP.test(g)) return { name: g };
    return null;
}

/** `{ value }` (the text to keep, "" for none) or `{ error }` (German). */
function checkButtonEmoji(text) {
    const s = String(text === undefined || text === null ? "" : text).trim();
    if (!s) return { value: "" };
    if (!parseButtonEmoji(s)) return { error: `„${s}“ ist kein einzelnes Emoji. Erlaubt ist ein Emoji oder ein eigenes Discord-Emoji wie <:name:123456789012345678>.` };
    return { value: s };
}

/** The emoji for discord.js' `ButtonBuilder.setEmoji` (string or object), or undefined for none. */
function buttonEmojiFor(text) {
    const parsed = parseButtonEmoji(text);
    if (!parsed) return undefined;
    return parsed.id ? parsed : parsed.name;
}

/** A link button with its optional emoji before the label. */
function linkButton(label, url, emoji = "") {
    const button = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
    const e = buttonEmojiFor(emoji);
    return e ? button.setEmoji(e) : button;
}

module.exports = { parseButtonEmoji, checkButtonEmoji, buttonEmojiFor, linkButton };
