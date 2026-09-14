const fs = require("fs");
const path = require("path");
const md = require("../../src/utils/discordMarkdown");

const { parseInline, parseDiscordMarkdown } = md;
const TWIN = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web-client", "src", "lib", "discordMarkdown.ts"), "utf8");

describe("utils/discordMarkdown", () => {
    describe("parseInline", () => {
        it("keeps plain text as one token", () => {
            expect(parseInline("Raidtage: Mi + So")).toEqual([{ type: "text", text: "Raidtage: Mi + So" }]);
        });

        it("reads bold, italic, underline, strike and code", () => {
            expect(parseInline("**Pulse** sucht *dich* __jetzt__ ~~nie~~ `/apply`")).toEqual([
                { type: "bold", children: [{ type: "text", text: "Pulse" }] },
                { type: "text", text: " sucht " },
                { type: "italic", children: [{ type: "text", text: "dich" }] },
                { type: "text", text: " " },
                { type: "underline", children: [{ type: "text", text: "jetzt" }] },
                { type: "text", text: " " },
                { type: "strike", children: [{ type: "text", text: "nie" }] },
                { type: "text", text: " " },
                { type: "code", text: "/apply" },
            ]);
        });

        it("nests inline marks inside bold", () => {
            expect(parseInline("**Hyjal <:bt:12>**")).toEqual([
                { type: "bold", children: [{ type: "text", text: "Hyjal " }, { type: "emoji", name: "bt", id: "12", animated: false }] },
            ]);
        });

        it("reads custom and animated emojis without mistaking their underscores for italics", () => {
            expect(parseInline("<:holy_pala_x:118> <a:dance:9>")).toEqual([
                { type: "emoji", name: "holy_pala_x", id: "118", animated: false },
                { type: "text", text: " " },
                { type: "emoji", name: "dance", id: "9", animated: true },
            ]);
        });

        it("reads user, role and channel mentions", () => {
            expect(parseInline("<@1> <@!2> <@&3> <#4>")).toEqual([
                { type: "mention", kind: "user", id: "1" }, { type: "text", text: " " },
                { type: "mention", kind: "user", id: "2" }, { type: "text", text: " " },
                { type: "mention", kind: "role", id: "3" }, { type: "text", text: " " },
                { type: "mention", kind: "channel", id: "4" },
            ]);
        });

        it("leaves a lone asterisk alone", () => {
            expect(parseInline("5 * 3")).toEqual([{ type: "text", text: "5 * 3" }]);
        });
    });

    describe("parseDiscordMarkdown", () => {
        it("returns no blocks for an empty text", () => {
            expect(parseDiscordMarkdown("")).toEqual([]);
            expect(parseDiscordMarkdown(null)).toEqual([]);
            expect(parseDiscordMarkdown("\n  \n")).toEqual([]);
        });

        it("reads the three heading levels and subtext", () => {
            const blocks = parseDiscordMarkdown("# Eins\n## <:shadow:5> Shadow Priest\n### Drei\n-# klein");
            expect(blocks.map((b) => [b.type, b.level])).toEqual([["heading", 1], ["heading", 2], ["heading", 3], ["subtext", undefined]]);
            expect(blocks[1].children[0]).toEqual({ type: "emoji", name: "shadow", id: "5", animated: false });
        });

        it("does not read a heading without a space or with four hashes", () => {
            expect(parseDiscordMarkdown("#kein")[0].type).toBe("paragraph");
            expect(parseDiscordMarkdown("#### vier")[0].type).toBe("paragraph");
        });

        it("groups consecutive lines into one paragraph and splits at a blank line", () => {
            const blocks = parseDiscordMarkdown("Zeile 1\r\nZeile 2\n\nZeile 3");
            expect(blocks).toHaveLength(2);
            expect(blocks[0].lines).toHaveLength(2);
            expect(blocks[1].lines).toEqual([[{ type: "text", text: "Zeile 3" }]]);
        });

        it("groups list items and quotes", () => {
            const blocks = parseDiscordMarkdown("- eins\n* zwei\n> zitat\n> weiter\nText");
            expect(blocks.map((b) => [b.type, b.lines.length])).toEqual([["list", 2], ["quote", 2], ["paragraph", 1]]);
        });
    });

    it("keeps the client twin's regexes identical", () => {
        for (const key of ["HEADING_RE", "SUBTEXT_RE", "LIST_RE", "QUOTE_RE", "INLINE_RE"]) {
            const re = md[key];
            expect({ key, found: TWIN.includes(`export const ${key} = /${re.source}/${re.flags};`) }).toEqual({ key, found: true });
        }
        expect(TWIN).toContain(`export const DISCORD_CONTENT_LIMIT = ${md.DISCORD_CONTENT_LIMIT};`);
    });
});
