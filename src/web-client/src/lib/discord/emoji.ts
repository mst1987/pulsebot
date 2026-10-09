// The emoji picker's data and the one edit it makes to a channel name.
//
// The emojis come from emojibase-data (MIT, Unicode's CLDR names and search
// tags in German and English) and are downloaded only when a picker opens —
// one chunk per language, never with the page. Discord draws emojis with its
// own images, the menu with the system font, so only emojis every system the
// orga uses can draw are offered: up to Emoji 12.1 (Windows 10's font stops
// there), no skin-tone components, no country flags (Windows draws those as two
// letters).
//
// A channel name keeps at most one leading emoji group ("🐍・mi-16-09-ssc-tk"):
// picking an emoji replaces that group, or puts the emoji plus the category's
// separator in front of a name without one (setLeadEmoji).

export type Emoji = { e: string; label: string; tags: string[]; group: number };

/** One emoji of emojibase-data's data.json, only the fields read here. */
export type RawEmoji = { emoji: string; label: string; tags?: string[]; group?: number; order?: number; version?: number };

/** The newest Emoji version offered: what Windows 10's Segoe UI Emoji draws. */
export const MAX_EMOJI_VERSION = 12.1;

/** The picker's sections in Discord's order; group 2 (skin-tone components) is left out. */
export const EMOJI_GROUPS = [
    { id: 0, key: "smileys", icon: "😀" },
    { id: 1, key: "people", icon: "👋" },
    { id: 3, key: "nature", icon: "🐻" },
    { id: 4, key: "food", icon: "🍔" },
    { id: 5, key: "travel", icon: "🏰" },
    { id: 6, key: "activities", icon: "⚽" },
    { id: 7, key: "objects", icon: "💡" },
    { id: 8, key: "symbols", icon: "❤️" },
    { id: 9, key: "flags", icon: "🏁" },
] as const;

/** Country flags (regional indicators) and subdivision flags (tag characters). */
const FLAG_PARTS_RE = /[\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}]/u;
const GROUP_IDS = new Set<number>(EMOJI_GROUPS.map((g) => g.id));

/** The offered emojis of emojibase's list, in Unicode's order. */
export function toEmojis(raw: RawEmoji[]): Emoji[] {
    return raw
        .filter((r) => typeof r.group === "number" && GROUP_IDS.has(r.group))
        .filter((r) => (r.version ?? 0) <= MAX_EMOJI_VERSION && !FLAG_PARTS_RE.test(r.emoji))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((r) => ({ e: r.emoji, label: r.label, tags: r.tags || [], group: r.group as number }));
}

const cache = new Map<string, Promise<Emoji[]>>();

/** The emojis with their names in `lang` (German or English), downloaded once per language. */
export function loadEmojis(lang: string): Promise<Emoji[]> {
    const key = lang === "en" ? "en" : "de";
    let promise = cache.get(key);
    if (!promise) {
        const load = key === "en" ? import("emojibase-data/en/data.json") : import("emojibase-data/de/data.json");
        promise = load
            .then((mod) => toEmojis(((mod as { default?: unknown }).default ?? mod) as RawEmoji[]))
            .catch((err) => {
                cache.delete(key);
                throw err;
            });
        cache.set(key, promise);
    }
    return promise;
}

/** "🐻" and "🐻️" are the same emoji — the key a lookup compares. */
export const emojiKey = (e: string): string => e.replace(/️/g, "");

/**
 * The emojis matching a search, best first: a name that starts with the words,
 * then a tag that does, then a name that contains them. Every word of the query
 * must match (name or tag), so "rot herz" finds the red heart.
 */
export function searchEmojis(list: Emoji[], query: string, limit = 120): Emoji[] {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored: { emoji: Emoji; score: number; at: number }[] = [];
    list.forEach((emoji, at) => {
        const label = emoji.label.toLowerCase();
        const tags = emoji.tags.map((tag) => tag.toLowerCase());
        const matches = words.every((w) => label.includes(w) || tags.some((tag) => tag.startsWith(w)));
        if (!matches) return;
        const first = words[0];
        const score = label.startsWith(first) ? 0 : tags.some((tag) => tag === first) ? 1 : tags.some((tag) => tag.startsWith(first)) ? 2 : 3;
        scored.push({ emoji, score, at });
    });
    return scored.sort((a, b) => a.score - b.score || a.at - b.at).slice(0, limit).map((s) => s.emoji);
}

/** One emoji as a grapheme: a pictograph, a flag of two regional indicators or a keycap. */
const EMOJI_GRAPHEME_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

function graphemes(text: string): string[] {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** "🐍" of "🐍・mi-16-09", "🔥⚔️" of "🔥⚔️raid", "" of "mi-16-09": the emojis a name starts with. */
export function leadEmojiOf(name: string): string {
    let lead = "";
    for (const g of graphemes(String(name || ""))) {
        if (!EMOJI_GRAPHEME_RE.test(g)) break;
        lead += g;
    }
    return lead;
}

/** The separator a category puts between emoji and name when none is known. */
export const DEFAULT_EMOJI_SEPARATOR = "・";

/**
 * The name with `emoji` in front: an emoji the name starts with is replaced
 * (its separator stays), else the emoji and `separator` go in front. An empty
 * name gets emoji + separator, ready for the rest to be typed.
 */
export function setLeadEmoji(name: string, emoji: string, separator = DEFAULT_EMOJI_SEPARATOR): string {
    const text = String(name || "");
    const lead = leadEmojiOf(text);
    if (lead) return emoji + text.slice(lead.length);
    if (!text) return emoji + separator;
    // a name that already starts with a symbol ("・mi-16-09") only needs the emoji
    return /^[\p{L}\p{N}{]/u.test(text) ? emoji + separator + text : emoji + text;
}

/**
 * What a category's channels have: their leading emojis (most used first) and
 * the separator they put after them ("・", "│", "-", "" …).
 */
export function emojiStyleOf(names: string[]): { emojis: string[]; separator: string } {
    const counts = new Map<string, number>();
    const seps = new Map<string, number>();
    for (const name of names || []) {
        const lead = leadEmojiOf(name);
        if (!lead) continue;
        counts.set(lead, (counts.get(lead) || 0) + 1);
        const sep = (/^[^\p{L}\p{N}]*/u.exec(name.slice(lead.length)) || [""])[0];
        seps.set(sep, (seps.get(sep) || 0) + 1);
    }
    const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const separator = byCount(seps)[0];
    return { emojis: byCount(counts), separator: separator === undefined ? DEFAULT_EMOJI_SEPARATOR : separator };
}

const RECENT_KEY = "eh-emoji-recent";
const RECENT_MAX = 18;

/** The emojis this browser picked last, newest first (empty without storage). */
export function readRecentEmojis(): string[] {
    try {
        const list = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(list) ? list.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

/** Remembers a picked emoji for the "zuletzt benutzt" row; a blocked storage is fine. */
export function rememberEmoji(emoji: string): void {
    try {
        const next = [emoji, ...readRecentEmojis().filter((e) => emojiKey(e) !== emojiKey(emoji))].slice(0, RECENT_MAX);
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        // private window or blocked storage: the row just stays empty
    }
}
