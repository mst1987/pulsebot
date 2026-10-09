// The emoji picker's data and its one edit to a channel name (lib/discord/emoji.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_EMOJI_SEPARATOR, MAX_EMOJI_VERSION, emojiKey, emojiStyleOf, leadEmojiOf, loadEmojis, readRecentEmojis, rememberEmoji,
    searchEmojis, setLeadEmoji, toEmojis, type Emoji, type RawEmoji,
} from "./emoji";

const raw = (emoji: string, label: string, extra: Partial<RawEmoji> = {}): RawEmoji => ({ emoji, label, group: 3, order: 1, version: 1, tags: [], ...extra });

describe("toEmojis", () => {
    it("keeps what every system draws, in Unicode's order", () => {
        const list = toEmojis([
            raw("🐻", "Bär", { order: 2 }),
            raw("😀", "grinsendes Gesicht", { group: 0, order: 1 }),
            raw("🦫", "Biber", { version: 13 }), // newer than Windows 10's font
            raw("🏻", "helle Hautfarbe", { group: 2 }), // a skin-tone component
            raw("🇩🇪", "Flagge: Deutschland", { group: 9 }), // two regional indicators
            raw("🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Flagge: England", { group: 9 }), // tag characters
            raw("🏁", "Zielflagge", { group: 9, order: 3 }),
            { emoji: "🅰", label: "regional", order: 0 }, // no group at all
        ]);
        expect(list.map((e) => e.e)).toEqual(["😀", "🐻", "🏁"]);
        expect(list[1]).toEqual({ e: "🐻", label: "Bär", tags: [], group: 3 });
    });

    it("stops at Emoji 12.1", () => {
        expect(MAX_EMOJI_VERSION).toBe(12.1);
        expect(toEmojis([raw("🥱", "gähnendes Gesicht", { version: 12 })])).toHaveLength(1);
    });
});

describe("loadEmojis", () => {
    it("loads the German names, and the English ones for English", async () => {
        const de = await loadEmojis("de");
        const en = await loadEmojis("en");
        expect(de.find((e) => e.e === "🐻")?.label).toBe("Bär");
        expect(en.find((e) => e.e === "🐻")?.label).toBe("bear");
        expect(de.length).toBeGreaterThan(1000);
        // the same promise for the same language: one download
        expect(loadEmojis("de")).toBe(loadEmojis("de"));
    });
});

describe("searchEmojis", () => {
    const list: Emoji[] = [
        { e: "🧸", label: "Teddybär", tags: ["spielzeug"], group: 6 },
        { e: "🐻", label: "Bär", tags: ["bär", "tier"], group: 3 },
        { e: "❤️", label: "rotes Herz", tags: ["herz", "rot"], group: 8 },
        { e: "💙", label: "blaues Herz", tags: ["herz", "blau"], group: 8 },
    ];

    it("puts a name starting with the word first, then a tag, then a name containing it", () => {
        expect(searchEmojis(list, "bär").map((e) => e.e)).toEqual(["🐻", "🧸"]);
        expect(searchEmojis(list, "Herz").map((e) => e.e)).toEqual(["❤️", "💙"]);
    });

    it("needs every word to match", () => {
        expect(searchEmojis(list, "rot herz").map((e) => e.e)).toEqual(["❤️"]);
        expect(searchEmojis(list, "grün herz")).toEqual([]);
    });

    it("finds nothing for an empty query and keeps to the limit", () => {
        expect(searchEmojis(list, "   ")).toEqual([]);
        expect(searchEmojis(list, "herz", 1)).toHaveLength(1);
    });
});

describe("leadEmojiOf", () => {
    it.each([
        ["🐍・mi-16-09-ssc-tk", "🐍"],
        ["🔥⚔️raid", "🔥⚔️"],
        ["❤️-herz", "❤️"],
        ["mi-16-09", ""],
        ["・mi-16-09", ""],
        ["", ""],
    ])("%s → %s", (name, lead) => {
        expect(leadEmojiOf(name)).toBe(lead);
    });
});

describe("setLeadEmoji", () => {
    it("replaces the emoji a name starts with and keeps its separator", () => {
        expect(setLeadEmoji("🐍・mi-16-09-za", "🐻")).toBe("🐻・mi-16-09-za");
        expect(setLeadEmoji("🔥⚔️│raid", "🐻")).toBe("🐻│raid");
    });

    it("puts emoji and separator in front of a name without one", () => {
        expect(setLeadEmoji("mi-16-09-za", "🐻")).toBe(`🐻${DEFAULT_EMOJI_SEPARATOR}mi-16-09-za`);
        expect(setLeadEmoji("mi-16-09-za", "🐻", "│")).toBe("🐻│mi-16-09-za");
        expect(setLeadEmoji("{tag}-{dd}-{mm}-{raid}", "🐻", "-")).toBe("🐻-{tag}-{dd}-{mm}-{raid}");
    });

    it("adds no second separator and gives an empty name emoji plus separator", () => {
        expect(setLeadEmoji("・mi-16-09", "🐻")).toBe("🐻・mi-16-09");
        expect(setLeadEmoji("", "🐻")).toBe("🐻・");
    });
});

describe("emojiStyleOf", () => {
    it("lists the category's emojis by use and takes its separator", () => {
        expect(emojiStyleOf(["🐍│mi-01-10-ssc", "🔥│do-02-10-tk", "🐍│mi-08-10-ssc", "allgemein"]))
            .toEqual({ emojis: ["🐍", "🔥"], separator: "│" });
    });

    it("knows an empty separator, and falls back to the default without any emoji", () => {
        expect(emojiStyleOf(["🐍mi-01-10"]).separator).toBe("");
        expect(emojiStyleOf(["mi-01-10", "allgemein"])).toEqual({ emojis: [], separator: DEFAULT_EMOJI_SEPARATOR });
    });
});

describe("recent emojis", () => {
    afterEach(() => window.localStorage.clear());

    it("keeps the newest first, without repeats", () => {
        rememberEmoji("🐻");
        rememberEmoji("🐍");
        rememberEmoji("🐻");
        expect(readRecentEmojis()).toEqual(["🐻", "🐍"]);
    });

    it("treats the emoji with and without variation selector as one", () => {
        expect(emojiKey("❤️")).toBe(emojiKey("❤"));
        rememberEmoji("❤");
        rememberEmoji("❤️");
        expect(readRecentEmojis()).toEqual(["❤️"]);
    });

    it("is empty and quiet when the storage is blocked or broken", () => {
        window.localStorage.setItem("eh-emoji-recent", "{kaputt");
        expect(readRecentEmojis()).toEqual([]);
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        expect(() => rememberEmoji("🐻")).not.toThrow();
    });
});
