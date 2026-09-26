// The subset of Discord's message markdown a recruitment text uses, parsed into
// a small tree the admin menu's "Vorschau in Discord" draws. Blocks: headings
// (#, ##, ###), subtext (-#), bullet lists, quotes and paragraphs (consecutive
// lines, a blank line ends one). Inline: **bold**, __underline__, *italic* /
// _italic_, ~~strike~~, `code`, custom emojis <:name:id> and mentions.
//
// TEST SUPPORT, not production code: the client renders with
// src/web-client/src/lib/discordMarkdown.ts (TypeScript, which the Jest suite
// cannot load). This JS twin is what test/web-client/discordMarkdown.test.js
// exercises, and that test holds the two regex sets in step. The Vitest suite
// of the client (#435) replaces both.

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const SUBTEXT_RE = /^-#\s+(.+)$/;
const LIST_RE = /^\s*[-*]\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
// 1 bold · 2 underline · 3 italic (*) · 4 italic (_) · 5 strike · 6 code ·
// 7 "a" of an animated emoji · 8 emoji name · 9 emoji id · 10 user · 11 role · 12 channel
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|_([^_\s](?:[^_]*[^_\s])?)_|~~(.+?)~~|`([^`]+)`|<(a?):(\w+):(\d+)>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>/g;

const WRAPS = [[1, "bold"], [2, "underline"], [3, "italic"], [4, "italic"], [5, "strike"]];

/** Inline tokens of one line of text. */
function parseInline(text) {
    const out = [];
    const src = String(text || "");
    const re = new RegExp(INLINE_RE.source, "g");
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
        if (m.index > last) out.push({ type: "text", text: src.slice(last, m.index) });
        last = m.index + m[0].length;
        const wrap = WRAPS.find(([g]) => m[g] !== undefined);
        if (wrap) out.push({ type: wrap[1], children: parseInline(m[wrap[0]]) });
        else if (m[6] !== undefined) out.push({ type: "code", text: m[6] });
        else if (m[9] !== undefined) out.push({ type: "emoji", name: m[8], id: m[9], animated: m[7] === "a" });
        else if (m[10] !== undefined) out.push({ type: "mention", kind: "user", id: m[10] });
        else if (m[11] !== undefined) out.push({ type: "mention", kind: "role", id: m[11] });
        else out.push({ type: "mention", kind: "channel", id: m[12] });
    }
    if (last < src.length) out.push({ type: "text", text: src.slice(last) });
    return out;
}

/** The blocks of a whole message. */
function parseDiscordMarkdown(text) {
    const blocks = [];
    let open = null;
    for (const line of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
        let m;
        if (!line.trim()) { open = null; continue; }
        if ((m = HEADING_RE.exec(line))) {
            open = null;
            blocks.push({ type: "heading", level: m[1].length, children: parseInline(m[2].trim()) });
        } else if ((m = SUBTEXT_RE.exec(line))) {
            open = null;
            blocks.push({ type: "subtext", children: parseInline(m[1]) });
        } else if ((m = LIST_RE.exec(line))) {
            if (!open || open.type !== "list") { open = { type: "list", lines: [] }; blocks.push(open); }
            open.lines.push(parseInline(m[1]));
        } else if ((m = QUOTE_RE.exec(line))) {
            if (!open || open.type !== "quote") { open = { type: "quote", lines: [] }; blocks.push(open); }
            open.lines.push(parseInline(m[1]));
        } else {
            if (!open || open.type !== "paragraph") { open = { type: "paragraph", lines: [] }; blocks.push(open); }
            open.lines.push(parseInline(line));
        }
    }
    return blocks;
}

/** Discord's limit for a message's text. */
const DISCORD_CONTENT_LIMIT = 2000;

module.exports = { HEADING_RE, SUBTEXT_RE, LIST_RE, QUOTE_RE, INLINE_RE, DISCORD_CONTENT_LIMIT, parseInline, parseDiscordMarkdown };
