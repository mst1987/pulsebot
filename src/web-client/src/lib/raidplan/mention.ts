// "That is you": where the visitor's own characters are named in free text (notes, texts, titles, free-text targets) and how a text
// is cut into the parts that name them. Pure, so the rule is tested (src/web-client/src/lib/mention.test.ts). Written with function
// declarations and one-line signatures only (the tests load it).
import type { RaidplanAssignment } from "../../api";

export type TextPart = { text: string; hit: boolean };

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names worth looking for: whole names of the visitor's characters (at least two letters), each once. */
export function cleanNames(names: string[]): string[] {
    const out = [];
    for (const n of names) {
        const v = String(n === null || n === undefined ? "" : n).trim();
        if (v.length >= 2 && out.map((x) => x.toLowerCase()).indexOf(v.toLowerCase()) < 0) out.push(v);
    }
    return out;
}

/** The text cut into parts, the ones that name one of the characters (as a whole word, upper / lower case ignored) marked. */
export function splitMentions(text: string, names: string[]): TextPart[] {
    const list = cleanNames(names);
    const src = String(text === null || text === undefined ? "" : text);
    if (list.length === 0 || src === "") return [{ text: src, hit: false }];
    // longest first, so "Heilbert" wins over "Heil"; a name is a whole word (a letter next to it means it is part of another word)
    const alt = list.slice().sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${alt})(?![\\p{L}\\p{N}_])`, "giu");
    const parts = [];
    let last = 0;
    let m = re.exec(src);
    while (m) {
        if (m.index > last) parts.push({ text: src.slice(last, m.index), hit: false });
        parts.push({ text: m[0], hit: true });
        last = m.index + m[0].length;
        m = re.exec(src);
    }
    if (last < src.length) parts.push({ text: src.slice(last), hit: false });
    return parts.length > 0 ? parts : [{ text: src, hit: false }];
}

/** Whether a text names one of the characters. */
export function mentions(text: string, names: string[]): boolean {
    return splitMentions(text, names).some((p) => p.hit);
}

/** Whether an assignment names the visitor in words: its title, its note or a free-text target. */
export function mentionsInRow(a: RaidplanAssignment, names: string[]): boolean {
    if (mentions(a.title, names) || mentions(a.note, names)) return true;
    return a.targets.some((tg) => tg.kind === "text" && mentions(tg.ref, names));
}
