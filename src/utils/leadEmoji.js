// The leading emoji of a channel name and the one edit the icon pickers make to it.
//
// Backend twin of the helpers in src/web-client/src/lib/discord/emoji.ts
// (leadEmojiOf, setLeadEmoji, emojiStyleOf, DEFAULT_EMOJI_SEPARATOR);
// test/utils/leadEmoji.test.js keeps the regular expressions and the default
// separator identical. A channel name keeps at most one leading emoji group
// ("🐍・mi-16-09-ssc-tk"): a pick replaces that group, or puts the emoji plus the
// category's separator in front of a name without one.

/** One emoji as a grapheme: a pictograph, a flag of two regional indicators or a keycap. */
const EMOJI_GRAPHEME_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
/** A name that starts with a letter, digit or "{" needs a separator after the emoji. */
const NAME_START_RE = /^[\p{L}\p{N}{]/u;

/** The separator a category puts between emoji and name when none is known. */
const DEFAULT_EMOJI_SEPARATOR = "・";

/** "🐻" and "🐻" + variation selector are the same emoji — the key a lookup compares. */
const emojiKey = (e) => String(e || "").replace(/️/g, "");

function graphemes(text) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** "🐍" of "🐍・mi-16-09", "🔥⚔️" of "🔥⚔️raid", "" of "mi-16-09": the emojis a name starts with. */
function leadEmojiOf(name) {
    let lead = "";
    for (const g of graphemes(String(name || ""))) {
        if (!EMOJI_GRAPHEME_RE.test(g)) break;
        lead += g;
    }
    return lead;
}

/**
 * The name with `emoji` in front: an emoji the name starts with is replaced
 * (its separator stays), else the emoji and `separator` go in front.
 */
function setLeadEmoji(name, emoji, separator = DEFAULT_EMOJI_SEPARATOR) {
    const text = String(name || "");
    const lead = leadEmojiOf(text);
    if (lead) return emoji + text.slice(lead.length);
    if (!text) return emoji + separator;
    // a name that already starts with a symbol ("・mi-16-09") only needs the emoji
    return NAME_START_RE.test(text) ? emoji + separator + text : emoji + text;
}

/** The name without its leading emoji and the separator that followed it. */
function stripLeadEmoji(name) {
    const text = String(name || "");
    const lead = leadEmojiOf(text);
    if (!lead) return text;
    return text.slice(lead.length).replace(/^[^\p{L}\p{N}]*/u, "");
}

/**
 * What a category's channels have: their leading emojis (most used first) and
 * the separator they put after them ("・", "│", "-", "" …).
 */
function emojiStyleOf(names) {
    const counts = new Map();
    const seps = new Map();
    for (const name of names || []) {
        const lead = leadEmojiOf(name);
        if (!lead) continue;
        counts.set(lead, (counts.get(lead) || 0) + 1);
        const sep = (/^[^\p{L}\p{N}]*/u.exec(name.slice(lead.length)) || [""])[0];
        seps.set(sep, (seps.get(sep) || 0) + 1);
    }
    const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const separator = byCount(seps)[0];
    return { emojis: byCount(counts), separator: separator === undefined ? DEFAULT_EMOJI_SEPARATOR : separator };
}

module.exports = {
    EMOJI_GRAPHEME_RE, NAME_START_RE, DEFAULT_EMOJI_SEPARATOR, emojiKey, leadEmojiOf, setLeadEmoji, stripLeadEmoji, emojiStyleOf,
};
