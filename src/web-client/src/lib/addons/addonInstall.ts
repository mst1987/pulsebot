// Pure helpers of the page "Addons" (#818) and its detail page /addon/<id>:
// where a zip goes for the game version shown, and the release notes — as
// plain text for the card, as a small safe structure for the detail page.

import { formatSize } from "../format";

/** Where an admin sets the GitHub token (Einstellungen → Verbindungen). */
export const TOKEN_SETTINGS_LINK = "/settings/all?section=verbindungen";

/** The detail page of an addon (pages/addon/AddonDetailPage.tsx): its patch notes in full. */
export const addonDetailPath = (addonId: string) => `/addon/${encodeURIComponent(addonId)}`;

/** "LevelHelper-0.3.0.zip · 380 KB" */
export function fileLabel(file: { name: string; size: number }): string {
    const size = formatSize(file.size);
    return size ? `${file.name} · ${size}` : file.name;
}

/** The game client folder of each version, under the WoW install folder. */
const CLIENT_FOLDER: Record<string, string> = {
    forever: "_forever_",
    tbc: "_anniversary_",
    classic: "_classic_era_",
};

/** `<WoW>\_forever_\Interface\AddOns\` for a version (WoW Forever's folder when unknown). */
export function addonFolder(versionId: string): string {
    const folder = CLIENT_FOLDER[versionId] || CLIENT_FOLDER.forever;
    return `<WoW>\\${folder}\\Interface\\AddOns\\`;
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
/** GitHub's generated block ("## What's Changed", its PR list, "New Contributors"). */
const GENERATED_HEAD = /^\s{0,3}#{1,6}\s+what['’]?s\s+changed\b/i;
/** GitHub's "**Full Changelog**: https://github.com/…/compare/v1...v2" line. */
const FULL_CHANGELOG = /^\s*(\*\*|__)?full changelog\b/i;

/**
 * The release notes without what GitHub writes on its own: the block
 * "## What's Changed" with everything below it, and every "**Full Changelog**"
 * line. Line endings become "\n".
 */
export function ownNotes(markdown: string): string {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const cut = lines.findIndex((line) => GENERATED_HEAD.test(line));
    return (cut === -1 ? lines : lines.slice(0, cut))
        .filter((line) => !FULL_CHANGELOG.test(line))
        .join("\n")
        .trim();
}

/** `[text](url)` keeps its text, `<https://…>` goes: the notes never link anywhere. */
function dropLinks(text: string): string {
    return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<(https?:\/\/[^>\s]+)>/g, "$1");
}

/**
 * GitHub's Markdown release notes as plain lines: heading marks, bold/italic
 * marks, inline code ticks and link targets go, list bullets become "•", the
 * generated "What's Changed" block goes (ownNotes). The page shows them as
 * text (never as HTML), so nothing in a release can inject markup.
 */
export function plainNotes(markdown: string): string {
    return ownNotes(markdown)
        .split("\n")
        .map((line) => dropLinks(line
            .replace(/^\s{0,3}#{1,6}\s+/, "")
            .replace(/^(\s*)[-*+]\s+/, "$1• "))
            .replace(/(\*\*|__)(.+?)\1/g, "$2")
            .replace(/`([^`]+)`/g, "$1")
            .trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** One piece of a line: plain text, **bold** or `code`. Rendered as React text, never as HTML. */
export type NoteSpan = { kind: "text" | "bold" | "code"; text: string };
export type NoteBlock = { type: "list"; items: NoteSpan[][] } | { type: "para"; spans: NoteSpan[] };
/** The colour of a group: Neu/New, Verbessert/Improved, Behoben/Fixed — any other heading is "other". */
export type NoteGroupKind = "new" | "better" | "fixed" | "other";
export type NoteGroup = { title: string; kind: NoteGroupKind; blocks: NoteBlock[] };

// Heading words of the release notes, German and English (the German ones are
// data the notes are matched against, not texts of the menu: umlauts escaped).
const GROUP_WORDS: Record<Exclude<NoteGroupKind, "other">, string[]> = {
    new: ["neu", "neues", "new", "added", "features", "neue funktionen", "hinzugef\u00fcgt"],
    better: ["verbessert", "verbesserungen", "improved", "improvements", "changed", "changes", "ge\u00e4ndert", "\u00e4nderungen"],
    fixed: ["behoben", "fehlerbehebungen", "fixed", "fixes", "bugfixes", "bug fixes"],
};

/** Which colour a group heading gets ("Neu" -> new, "Bug fixes" -> fixed, "Hinweise" -> other). */
export function groupKind(title: string): NoteGroupKind {
    const word = title.toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();
    for (const [kind, words] of Object.entries(GROUP_WORDS)) {
        if (words.includes(word)) return kind as NoteGroupKind;
    }
    return "other";
}

/**
 * A line's text as spans: `code` and **bold** (or __bold__) marked, *italic*
 * kept as plain text without its stars, links reduced to their text.
 */
export function noteSpans(line: string): NoteSpan[] {
    const text = dropLinks(line);
    const spans: NoteSpan[] = [];
    const push = (kind: NoteSpan["kind"], value: string) => {
        if (!value) return;
        const last = spans[spans.length - 1];
        if (last && last.kind === kind && kind === "text") last.text += value;
        else spans.push({ kind, text: value });
    };
    const re = /`([^`]+)`|(\*\*|__)(.+?)\2|\*([^*\s][^*]*?)\*/g;
    let at = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        push("text", text.slice(at, m.index));
        if (m[1] !== undefined) push("code", m[1]);
        else if (m[4] !== undefined) push("text", m[4]);
        else push("bold", m[3].replace(/`([^`]+)`/g, "$1"));
        at = m.index + m[0].length;
    }
    push("text", text.slice(at));
    return spans;
}

/** A heading's text without its marks. */
const headingText = (raw: string) => noteSpans(raw).map((s) => s.text).join("").trim();

/**
 * The release notes as groups for the detail page: a heading (`#` to `######`)
 * starts a group, "- " / "* " / "+ " lines are its list (a following indented
 * or plain line continues the item), other lines its paragraphs. Text before
 * the first heading is a group without a title. GitHub's generated block goes
 * first (ownNotes). Only text comes out — no HTML, no links.
 */
export function noteGroups(markdown: string): NoteGroup[] {
    // first the lines of each block, the spans at the end
    type RawBlock = { type: "list"; items: string[] } | { type: "para"; lines: string[] };
    type RawGroup = { title: string; blocks: RawBlock[] };
    const groups: RawGroup[] = [];
    let open: RawBlock | null = null;
    const group = () => {
        if (!groups.length) groups.push({ title: "", blocks: [] });
        return groups[groups.length - 1];
    };
    for (const raw of ownNotes(markdown).split("\n")) {
        // a quote ("> …") reads as its plain text
        const line = raw.replace(/^\s{0,3}>\s?/, "");
        const heading = HEADING.exec(line);
        const bullet = BULLET.exec(line);
        if (heading) {
            groups.push({ title: headingText(heading[1]), blocks: [] });
            open = null;
        } else if (!line.trim()) {
            open = null;
        } else if (bullet) {
            if (!open || open.type !== "list") {
                open = { type: "list", items: [] };
                group().blocks.push(open);
            }
            open.items.push(bullet[1].trim());
        } else if (open && open.type === "list") {
            // a wrapped or indented line continues the item above
            open.items[open.items.length - 1] += ` ${line.trim()}`;
        } else {
            if (!open) {
                open = { type: "para", lines: [] };
                group().blocks.push(open);
            }
            open.lines.push(line.trim());
        }
    }
    return groups
        // a heading with nothing under it says nothing
        .filter((g) => g.blocks.length > 0)
        .map((g) => ({
            title: g.title,
            kind: g.title ? groupKind(g.title) : "other",
            blocks: g.blocks.map((b): NoteBlock => (b.type === "list"
                ? { type: "list", items: b.items.map(noteSpans) }
                : { type: "para", spans: noteSpans(b.lines.join(" ")) })),
        }));
}
