const {
    EMBED_LIMITS, clip, webUrl, clampEmbed, embedSize, linkRow, lookupReply, deferLookup,
    rankChoices, respondChoices, focusedName, discordTime, plural,
} = require("../../../src/utils/discord/botLookup");
const { MessageFlags } = require("discord.js");
const { publicBaseUrl } = require("../../../src/config/variables");
const { mockInteraction } = require("../../helpers/mockInteraction");

describe("utils/discord/botLookup", () => {
    it("clips text with an ellipsis only when something was dropped", () => {
        expect(clip("abc", 5)).toBe("abc");
        expect(clip("abcdef", 4)).toBe("abc…");
        expect(clip(null, 4)).toBe("");
    });

    it("builds absolute web links from the public base url", () => {
        const base = publicBaseUrl.replace(/\/+$/, "");
        expect(webUrl("/raids")).toBe(`${base}/raids`);
        expect(webUrl("r/abc")).toBe(`${base}/r/abc`);
    });

    it("keeps an embed within Discord's limits", () => {
        const huge = "x".repeat(5000);
        const embed = clampEmbed({
            title: huge,
            description: huge,
            fields: Array.from({ length: 40 }, (_, i) => ({ name: `Feld ${i}`, value: huge })),
        });
        expect(embed.title.length).toBeLessThanOrEqual(EMBED_LIMITS.title);
        expect(embed.description.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
        expect((embed.fields || []).length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
        for (const f of embed.fields || []) expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
        expect(embedSize(embed)).toBeLessThanOrEqual(EMBED_LIMITS.total);
    });

    it("drops empty fields and keeps a given colour", () => {
        const embed = clampEmbed({ title: "T", color: 1, fields: [{ name: "a", value: "" }, { name: "b", value: "x" }] });
        expect(embed.color).toBe(1);
        expect(embed.fields).toEqual([{ name: "b", value: "x", inline: false }]);
    });

    it("makes a row of at most five link buttons and skips non-http urls", () => {
        const links = Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, url: `https://x/${i}` }));
        const [row] = linkRow([{ label: "kaputt", url: "javascript:1" }, ...links]);
        expect(row.components).toHaveLength(5);
        expect(row.components[0]).toEqual({ type: 2, style: 5, label: "L0", url: "https://x/0" });
        expect(linkRow([])).toEqual([]);
    });

    it("replies ephemerally, or edits after a defer", async () => {
        const i = mockInteraction();
        await lookupReply(i, { title: "T" }, [{ label: "Im Web öffnen", url: "https://x" }]);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, embeds: [expect.objectContaining({ title: "T" })] }));

        const d = mockInteraction();
        await deferLookup(d);
        expect(d.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        await lookupReply(d, { title: "T" });
        expect(d.editReply).toHaveBeenCalled();
        expect(d.editReply.mock.calls[0][0].flags).toBeUndefined();
    });

    it("ranks choices by prefix, then by substring, capped at 25 and 100 characters", () => {
        const entries = [
            { name: "Staff of Disintegration", value: "1" },
            { name: "Cowl of Tirisfal", value: "2" },
            { name: "Tirisfal Wand", value: "3" },
        ];
        expect(rankChoices(entries, "tiri").map((c) => c.value)).toEqual(["3", "2"]);
        const many = Array.from({ length: 60 }, (_, i) => ({ name: `${"n".repeat(150)}${i}`, value: String(i) }));
        const choices = rankChoices(many, "");
        expect(choices).toHaveLength(25);
        expect(choices[0].name.length).toBeLessThanOrEqual(100);
        expect(rankChoices([{ name: "A", value: "1" }, { name: "A2", value: "1" }], "")).toHaveLength(1);
    });

    it("responds to autocomplete with what the focused option matches", async () => {
        const i = mockInteraction({ focused: { name: "item", value: "Cow" } });
        expect(focusedName(i)).toBe("item");
        await respondChoices(i, [{ name: "Cowl", value: "2" }, { name: "Staff", value: "1" }]);
        expect(i.respond).toHaveBeenCalledWith([{ name: "Cowl", value: "2" }]);
    });

    it("formats Discord timestamps from seconds or milliseconds", () => {
        expect(discordTime(1700000000)).toBe("<t:1700000000:d>");
        expect(discordTime(1700000000123, "f")).toBe("<t:1700000000:f>");
        expect(discordTime(0)).toBe("");
        expect(plural(1, "Item", "Items")).toBe("1 Item");
        expect(plural(2, "Item", "Items")).toBe("2 Items");
    });
});
