jest.mock("../../../src/classes/legendary.js");
jest.mock("../../../src/utils/legendary.js");

const command = require("../../../src/commands/auction/endAuction.js");
const Legendary = require("../../../src/classes/legendary.js");
const {
    getTargetMessage,
    updateHighestBids,
} = require("../../../src/utils/legendary.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { adminUserId } = require("../../../src/config/variables.js");

describe("commands/auction/endAuction", () => {
    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "endauction",
                description: expect.any(String),
                execute: expect.any(Function),
            })
        );
    });

    it("blocks a non-admin user", async () => {
        const interaction = mockInteraction({ userId: "123" });

        await command.execute(interaction, {});

        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe(
            "Fehlende Berechtigung"
        );
        expect(Legendary).not.toHaveBeenCalled();
    });

    it("announces the winner and refreshes the highest-bids overview on success", async () => {
        const getWinner = jest.fn().mockResolvedValue({
            type: "success",
            legendary: { name: "Dragonwrath", raid: "Firelands" },
            winner: { userid: "999" },
        });
        Legendary.mockImplementation(() => ({ getWinner }));
        getTargetMessage.mockResolvedValue({ id: "target" });
        updateHighestBids.mockResolvedValue(undefined);

        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, { id: "client" });

        expect(getWinner).toHaveBeenCalledWith("channel-1");
        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe(
            "Auktion beendet!"
        );
        expect(getTargetMessage).toHaveBeenCalledTimes(1);
        expect(updateHighestBids).toHaveBeenCalledTimes(1);
    });

    it("reports an error on a non-success response", async () => {
        Legendary.mockImplementation(() => ({
            getWinner: jest.fn().mockResolvedValue({ type: "error" }),
        }));
        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, {});

        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("Fehler");
        expect(updateHighestBids).not.toHaveBeenCalled();
    });
});
