// Client twin of src/utils/discordMarkdown.js — same regexes, same tree. The
// tests run the JS module and check that both carry identical regexes
// (test/utils/discordMarkdown.test.js), so change them together.

export const HEADING_RE = /^(#{1,3})\s+(.+)$/;
export const SUBTEXT_RE = /^-#\s+(.+)$/;
export const LIST_RE = /^\s*[-*]\s+(.+)$/;
export const QUOTE_RE = /^>\s?(.*)$/;
// 1 bold · 2 underline · 3 italic (*) · 4 italic (_) · 5 strike · 6 code ·
// 7 "a" of an animated emoji · 8 emoji name · 9 emoji id · 10 user · 11 role · 12 channel
export const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|_([^_\s](?:[^_]*[^_\s])?)_|~~(.+?)~~|`([^`]+)`|<(a?):(\w+):(\d+)>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>/g;

/** Discord's limit for a message's text. */
export const DISCORD_CONTENT_LIMIT = 2000;

export type InlineToken =
    | { type: "text"; text: string }
    | { type: "bold" | "underline" | "italic" | "strike"; children: InlineToken[] }
    | { type: "code"; text: string }
    | { type: "emoji"; name: string; id: string; animated: boolean }
    | { type: "mention"; kind: "user" | "role" | "channel"; id: string };

export type MdBlock =
    | { type: "heading"; level: number; children: InlineToken[] }
    | { type: "subtext"; children: InlineToken[] }
    | { type: "list" | "quote" | "paragraph"; lines: InlineToken[][] };

const WRAPS: [number, "bold" | "underline" | "italic" | "strike"][] = [[1, "bold"], [2, "underline"], [3, "italic"], [4, "italic"], [5, "strike"]];

/** Inline tokens of one line of text. */
export function parseInline(text: string): InlineToken[] {
    const out: InlineToken[] = [];
    const src = String(text || "");
    const re = new RegExp(INLINE_RE.source, "g");
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        const hit = m;
        if (hit.index > last) out.push({ type: "text", text: src.slice(last, hit.index) });
        last = hit.index + hit[0].length;
        const wrap = WRAPS.find(([g]) => hit[g] !== undefined);
        if (wrap) out.push({ type: wrap[1], children: parseInline(hit[wrap[0]]) });
        else if (hit[6] !== undefined) out.push({ type: "code", text: hit[6] });
        else if (hit[9] !== undefined) out.push({ type: "emoji", name: hit[8], id: hit[9], animated: hit[7] === "a" });
        else if (hit[10] !== undefined) out.push({ type: "mention", kind: "user", id: hit[10] });
        else if (hit[11] !== undefined) out.push({ type: "mention", kind: "role", id: hit[11] });
        else out.push({ type: "mention", kind: "channel", id: hit[12] });
    }
    if (last < src.length) out.push({ type: "text", text: src.slice(last) });
    return out;
}

/** The blocks of a whole message. */
export function parseDiscordMarkdown(text: string): MdBlock[] {
    const blocks: MdBlock[] = [];
    let open: { type: "list" | "quote" | "paragraph"; lines: InlineToken[][] } | null = null;
    for (const line of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
        let m: RegExpExecArray | null;
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
