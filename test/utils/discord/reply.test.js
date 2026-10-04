const {
    EMBED_LIMITS,
    clip,
    buildEmbed,
    embedPayload,
    botReply,
    botEditReply,
    botFollowup,
    findServerEmoji,
    getCharacterIcon,
} = require("../../../src/utils/discord/reply");
const { EMBED_ACCENT_COLOR } = require("../../../src/config/constants");
const { MessageFlags } = require("discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { entryFor } = require("../../../src/config/classlist.js");

const emoji = (name) => ({ name, toString: () => `<:${name}:1>` });

describe("utils/discord/reply", () => {
    afterEach(() => jest.useRealTimers());

    describe("server emojis", () => {
        it("getCharacterIcon finds the class icon of a spec", () => {
            const icon = entryFor("Holy1").icon;
            const interaction = mockInteraction({ emojis: [[icon, emoji(icon)]] });
            expect(getCharacterIcon(interaction, "Holy1")).toBe(`<:${icon}:1>`);
        });

        it("findServerEmoji finds an emoji by name, \"undefined\" without one", () => {
            const interaction = mockInteraction({ emojis: [["copium", emoji("copium")]] });
            expect(findServerEmoji(interaction, "copium")).toBe("<:copium:1>");
            expect(findServerEmoji(interaction, "missing")).toBe("undefined");
        });
    });

    describe("botReply / botEditReply / botFollowup", () => {
        it("botReply sends an embed with the given title and description", async () => {
            const interaction = mockInteraction();
            await botReply(interaction, "Titel", "Nachricht", 0);
            expect(interaction.reply).toHaveBeenCalledTimes(1);
            const arg = interaction.reply.mock.calls[0][0];
            expect(arg.embeds[0]).toMatchObject({ title: "Titel", description: "Nachricht" });
            expect(arg.flags).toBe(MessageFlags.Ephemeral);
        });

        it("botReply deletes the reply after the timeout and can be public", async () => {
            jest.useFakeTimers();
            const interaction = mockInteraction();
            await botReply(interaction, "T", "M", 1000, false);
            expect(interaction.reply.mock.calls[0][0].flags).toBeUndefined();
            const sent = await interaction.reply.mock.results[0].value;
            expect(sent.delete).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1000);
            expect(sent.delete).toHaveBeenCalledTimes(1);
        });

        it("botEditReply edits the deferred reply and passes the components", async () => {
            const interaction = mockInteraction();
            const components = [{ type: 1 }];
            await botEditReply(interaction, "T", "M", 0, true, components);
            expect(interaction.editReply).toHaveBeenCalledTimes(1);
            expect(interaction.editReply.mock.calls[0][0]).toMatchObject({
                embeds: [{ title: "T", description: "M" }],
                components,
            });
        });

        it("botFollowup sends an ephemeral follow-up with the message", async () => {
            const interaction = mockInteraction();
            await botFollowup(interaction, "Noch was", 0);
            const arg = interaction.followUp.mock.calls[0][0];
            expect(arg.embeds).toEqual([{ description: "Noch was" }]);
            expect(arg.flags).toBe(MessageFlags.Ephemeral);
        });

        it("botReply with { embed } sends one built embed, ephemeral, and keeps the components", async () => {
            const interaction = mockInteraction();
            const components = [{ type: 1, components: [] }];
            await botReply(interaction, {
                embed: { title: "Saved for Karazhan", description: "`1` Zibbo · Holy", fields: [{ name: "Start", value: "<t:2000000000:F>", inline: true }], footer: "EventHelper" },
                components,
                timeout: 0,
            });
            expect(interaction.reply.mock.calls[0][0]).toEqual({
                embeds: [{
                    color: EMBED_ACCENT_COLOR,
                    title: "Saved for Karazhan",
                    description: "`1` Zibbo · Holy",
                    fields: [{ name: "Start", value: "<t:2000000000:F>", inline: true }],
                    footer: { text: "EventHelper" },
                }],
                components,
                flags: MessageFlags.Ephemeral,
            });
        });

        it("botReply with { embed } can be public and deletes after its timeout", async () => {
            jest.useFakeTimers();
            const interaction = mockInteraction();
            await botReply(interaction, { embed: { description: "Hallo" }, ephemeral: false, timeout: 500 });
            const arg = interaction.reply.mock.calls[0][0];
            expect(arg.flags).toBeUndefined();
            expect(arg.embeds).toEqual([{ color: EMBED_ACCENT_COLOR, description: "Hallo" }]);
            const sent = await interaction.reply.mock.results[0].value;
            jest.advanceTimersByTime(500);
            expect(sent.delete).toHaveBeenCalledTimes(1);
        });

        it("botEditReply with { embed } clears the text and takes the colour it is given", async () => {
            const interaction = mockInteraction();
            await botEditReply(interaction, { embed: { title: "T", description: "D", color: 0x123456 } });
            expect(interaction.editReply.mock.calls[0][0]).toEqual({
                content: "",
                embeds: [{ color: 0x123456, title: "T", description: "D" }],
                components: [],
            });
        });

        it("botFollowup with { embed } sends an ephemeral follow-up embed", async () => {
            const interaction = mockInteraction();
            await botFollowup(interaction, { embed: { title: "T", description: "D" }, timeout: 0 });
            expect(interaction.followUp.mock.calls[0][0]).toEqual({
                embeds: [{ color: EMBED_ACCENT_COLOR, title: "T", description: "D" }],
                components: [],
                flags: MessageFlags.Ephemeral,
            });
        });

        it("swallows errors from Discord", async () => {
            jest.spyOn(console, "error").mockImplementation(() => {});
            const interaction = mockInteraction();
            interaction.reply.mockRejectedValueOnce(new Error("boom"));
            interaction.editReply.mockRejectedValueOnce(new Error("boom"));
            interaction.followUp.mockRejectedValueOnce(new Error("boom"));
            await expect(botReply(interaction, "T", "M", 0)).resolves.toBeUndefined();
            await expect(botEditReply(interaction, "T", "M")).resolves.toBeUndefined();
            await expect(botFollowup(interaction, "M", 0)).resolves.toBeUndefined();
            expect(console.error).toHaveBeenCalledTimes(3);
            console.error.mockRestore();
        });
    });

    describe("buildEmbed / clip (#508)", () => {
        it("clip keeps a short text and cuts a long one to the limit, ending in …", () => {
            expect(clip("kurz", 10)).toBe("kurz");
            expect(clip("abcdefghij", 5)).toBe("abcd…");
            expect(clip(null, 5)).toBe("");
            expect(clip("abc", 0)).toBe("");
        });

        it("cuts title, description, field name and value to Discord's limits", () => {
            const e = buildEmbed({
                title: "T".repeat(300),
                description: "D".repeat(5000),
                fields: [{ name: "N".repeat(300), value: "V".repeat(1100) }],
            });
            expect(e.title).toHaveLength(EMBED_LIMITS.title);
            expect(e.title.endsWith("…")).toBe(true);
            expect(e.description).toHaveLength(EMBED_LIMITS.description);
            expect(e.fields[0].name).toHaveLength(EMBED_LIMITS.fieldName);
            expect(e.fields[0].value).toHaveLength(EMBED_LIMITS.fieldValue);
        });

        it("keeps the whole embed under 6000 characters and at most 25 fields", () => {
            const fields = Array.from({ length: 30 }, (_, i) => ({ name: `F${i}`, value: "v".repeat(1000) }));
            const e = buildEmbed({ title: "t".repeat(256), description: "d".repeat(4096), fields });
            const total = e.title.length + e.description.length
                + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
            expect(total).toBeLessThanOrEqual(EMBED_LIMITS.total);
            expect(e.fields.length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
        });

        it("puts the author line above the title, cut to Discord's limit", () => {
            expect(buildEmbed({ author: "Log-Auswertung läuft", title: "SSC" }).author).toEqual({ name: "Log-Auswertung läuft" });
            expect(buildEmbed({ author: "x".repeat(300) }).author.name).toHaveLength(256);
            expect(buildEmbed({ title: "SSC" }).author).toBeUndefined();
        });

        it("leaves empty parts out, uses the accent colour and a timestamp as ISO", () => {
            expect(buildEmbed({})).toEqual({ color: EMBED_ACCENT_COLOR });
            const e = buildEmbed({ description: "x", timestamp: 0, footer: { text: "f", iconURL: "https://x.example/i.png" } });
            expect(e).toEqual({
                color: EMBED_ACCENT_COLOR,
                description: "x",
                footer: { text: "f", icon_url: "https://x.example/i.png" },
                timestamp: "1970-01-01T00:00:00.000Z",
            });
            expect(buildEmbed({ title: "T", url: "https://x.example" }).url).toBe("https://x.example");
            expect(buildEmbed({ fields: [{ name: "only a name" }] }).fields).toEqual([{ name: "only a name", value: "​", inline: false }]);
        });

        it("embedPayload is ephemeral unless told otherwise", () => {
            expect(embedPayload({ description: "x" })).toEqual({ embeds: [{ color: EMBED_ACCENT_COLOR, description: "x" }], components: [], flags: MessageFlags.Ephemeral });
            expect(embedPayload({ description: "x" }, { ephemeral: false }).flags).toBeUndefined();
        });
    });
});
