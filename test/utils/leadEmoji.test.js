const fs = require("fs");
const path = require("path");
const lead = require("../../src/utils/leadEmoji");

const TWIN = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web-client", "src", "lib", "discord", "emoji.ts"), "utf8");

const constant = (name) => {
    const m = new RegExp(`const ${name}\\b[^=]*=\\s*(/.+/[a-z]*);`).exec(TWIN);
    if (!m) throw new Error(`${name} not found in lib/discord/emoji.ts`);
    return m[1];
};

describe("utils/leadEmoji — twin of lib/discord/emoji.ts", () => {
    it("holds the same regular expressions and the same default separator", () => {
        expect(constant("EMOJI_GRAPHEME_RE")).toBe(String(lead.EMOJI_GRAPHEME_RE));
        expect(TWIN).toContain(`export const DEFAULT_EMOJI_SEPARATOR = "${lead.DEFAULT_EMOJI_SEPARATOR}";`);
        // setLeadEmoji's "needs a separator" test and emojiStyleOf's separator reading
        expect(TWIN).toContain(`${String(lead.NAME_START_RE)}.test(text)`);
        expect(TWIN).toContain("/^[^\\p{L}\\p{N}]*/u.exec(name.slice(lead.length))");
    });

    it("finds the emojis a name starts with", () => {
        expect(lead.leadEmojiOf("🐍・mi-16-09")).toBe("🐍");
        expect(lead.leadEmojiOf("🔥⚔️raid")).toBe("🔥⚔️");
        expect(lead.leadEmojiOf("mi-16-09")).toBe("");
        expect(lead.leadEmojiOf("")).toBe("");
        expect(lead.leadEmojiOf(undefined)).toBe("");
    });

    it("replaces the lead emoji and keeps its separator, else adds emoji + separator", () => {
        expect(lead.setLeadEmoji("🔥・mi-16-09", "🐍")).toBe("🐍・mi-16-09");
        expect(lead.setLeadEmoji("mi-16-09", "🐍")).toBe("🐍・mi-16-09");
        expect(lead.setLeadEmoji("mi-16-09", "🐍", "│")).toBe("🐍│mi-16-09");
        expect(lead.setLeadEmoji("・mi-16-09", "🐍")).toBe("🐍・mi-16-09");
        expect(lead.setLeadEmoji("", "🐍")).toBe("🐍・");
    });

    it("strips the lead emoji with its separator", () => {
        expect(lead.stripLeadEmoji("🔥・mi-16-09")).toBe("mi-16-09");
        expect(lead.stripLeadEmoji("🔥⚔️│raid")).toBe("raid");
        expect(lead.stripLeadEmoji("mi-16-09")).toBe("mi-16-09");
    });

    it("reads a category's style: emojis most used first, the usual separator", () => {
        expect(lead.emojiStyleOf(["🔥・a", "💀・b", "🔥・c", "plain"])).toEqual({ emojis: ["🔥", "💀"], separator: "・" });
        expect(lead.emojiStyleOf(["🔥│a", "💀│b", "🐍・c"]).separator).toBe("│");
        expect(lead.emojiStyleOf(["a", "b"])).toEqual({ emojis: [], separator: lead.DEFAULT_EMOJI_SEPARATOR });
        expect(lead.emojiStyleOf(undefined).emojis).toEqual([]);
    });

    it("treats an emoji with and without variation selector as the same", () => {
        expect(lead.emojiKey("⚔️")).toBe(lead.emojiKey("⚔"));
    });
});
