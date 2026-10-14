// The emoji of a link button: one unicode emoji or a custom Discord emoji, nothing else.
const { parseButtonEmoji, checkButtonEmoji, buttonEmojiFor, linkButton } = require("../../../src/utils/discord/buttonEmoji");

describe("utils/discord/buttonEmoji", () => {
    it("reads one unicode emoji, also with variation selector, ZWJ, skin tone, flag and keycap", () => {
        for (const e of ["📊", "🧙", "⚔️", "🛡️", "👨‍👩‍👧", "👍🏽", "🇩🇪", "1️⃣"]) expect(parseButtonEmoji(e)).toEqual({ name: e });
        expect(parseButtonEmoji("  📊  ")).toEqual({ name: "📊" });
    });

    it("reads a custom Discord emoji, animated or not", () => {
        expect(parseButtonEmoji("<:wcl:123456789012345678>")).toEqual({ id: "123456789012345678", name: "wcl", animated: false });
        expect(parseButtonEmoji("<a:party_1:123456789012345678>")).toEqual({ id: "123456789012345678", name: "party_1", animated: true });
    });

    it("treats empty as none and refuses everything else", () => {
        expect(parseButtonEmoji("")).toBeNull();
        expect(parseButtonEmoji(undefined)).toBeNull();
        for (const bad of ["a", "ab", "📊📊", "📊 x", "x📊", "<:x:1>", "<:wcl:abc>", ":wcl:", "https://x.example"]) expect(parseButtonEmoji(bad)).toBeNull();
    });

    it("answers with the text to keep or a German error", () => {
        expect(checkButtonEmoji("")).toEqual({ value: "" });
        expect(checkButtonEmoji(" 📊 ")).toEqual({ value: "📊" });
        expect(checkButtonEmoji("WCL").error).toContain("„WCL“ ist kein einzelnes Emoji");
    });

    it("hands discord.js a string for unicode and an object for a custom emoji", () => {
        expect(buttonEmojiFor("📊")).toBe("📊");
        expect(buttonEmojiFor("<:wcl:123456789012345678>")).toEqual({ id: "123456789012345678", name: "wcl", animated: false });
        expect(buttonEmojiFor("nope")).toBeUndefined();
    });

    it("builds a link button with the emoji before the label, or without", () => {
        expect(linkButton("WCL", "https://x.example", "📊").toJSON()).toMatchObject({ style: 5, label: "WCL", url: "https://x.example", emoji: { name: "📊" } });
        expect(linkButton("WCL", "https://x.example", "<a:pp:123456789012345678>").toJSON().emoji).toEqual({ id: "123456789012345678", name: "pp", animated: true });
        expect(linkButton("WCL", "https://x.example").toJSON().emoji).toBeUndefined();
    });
});
