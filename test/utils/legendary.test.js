const { updateHighestBids, getTargetMessage } = require("../../src/utils/legendary.js");
const { formatNumberWithDots } = require("../../src/utils/helper.js");
const { mockInteraction } = require("../helpers/mockInteraction.js");

function emoji(name) {
    return { name, toString: () => `<:${name}:1>` };
}

describe("utils/legendary", () => {
    describe("getTargetMessage", () => {
        it("fetches the channel then the message inside it", async () => {
            const message = { id: "m1" };
            const channel = {
                messages: { fetch: jest.fn().mockResolvedValue(message) },
            };
            const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };

            const result = await getTargetMessage(client, "chan", "msg");
            expect(client.channels.fetch).toHaveBeenCalledWith("chan");
            expect(channel.messages.fetch).toHaveBeenCalledWith("msg");
            expect(result).toBe(message);
        });

        it("returns false when the channel cannot be fetched", async () => {
            const client = { channels: { fetch: jest.fn().mockResolvedValue(null) } };
            const result = await getTargetMessage(client, "chan", "msg");
            expect(result).toBe(false);
        });
    });

    describe("updateHighestBids", () => {
        it("edits the target message with active and won auction lines, skipping the pinned id", async () => {
            const interaction = mockInteraction({
                emojis: [["peepoParty", emoji("peepoParty")]],
            });
            const future = Date.now() + 10_000_000_000;
            const past = Date.now() - 10_000_000_000;
            const legendary = {
                getHighestBids: jest.fn().mockResolvedValue({
                    highestBids: [
                        { _id: "chanActive", endtime: future, highestGold: 1000000, userid: "u1" },
                        { _id: "chanWon", endtime: past, highestGold: 2000000, userid: "u2" },
                        { _id: "1152194523951267931", endtime: future, highestGold: 5, userid: "skip" },
                    ],
                }),
            };
            const client = { channels: { fetch: jest.fn().mockResolvedValue({}) } };
            const targetMessage = { edit: jest.fn().mockResolvedValue(undefined) };

            await updateHighestBids(interaction, targetMessage, legendary, client);

            expect(targetMessage.edit).toHaveBeenCalledTimes(1);
            const embed = targetMessage.edit.mock.calls[0][0].embeds[0];
            expect(embed.title).toBe("Auktionsübersicht");
            // Active auction line
            expect(embed.description).toContain(`<#chanActive> **${formatNumberWithDots(1000000)}g** from <@u1>`);
            // Won auction line
            expect(embed.description).toContain(`Gewonnen von <@u2> für **${formatNumberWithDots(2000000)}g**`);
            expect(embed.description).toContain("<:peepoParty:1>");
            // The pinned/skipped id must not appear
            expect(embed.description).not.toContain("1152194523951267931");
        });

        it("does not edit anything when the channel is missing", async () => {
            const interaction = mockInteraction();
            const legendary = {
                getHighestBids: jest.fn().mockResolvedValue({ highestBids: [] }),
            };
            const client = { channels: { fetch: jest.fn().mockResolvedValue(null) } };
            const targetMessage = { edit: jest.fn().mockResolvedValue(undefined) };

            await updateHighestBids(interaction, targetMessage, legendary, client);
            expect(targetMessage.edit).not.toHaveBeenCalled();
        });
    });
});
