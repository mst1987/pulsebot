const {
    botReply,
    botEditReply,
    botFollowup,
    findServerEmoji,
    getCharacterIcon,
} = require("../../../src/utils/discord/reply");
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
});
