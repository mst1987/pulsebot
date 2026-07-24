const command = require("../../../src/commands/auction/auctionStatus.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { adminUserId } = require("../../../src/config/variables.js");

describe("commands/auction/auctionStatus", () => {
    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "auctionstatus",
                description: expect.any(String),
                execute: expect.any(Function),
            })
        );
    });

    it("rejects a non-admin user with a permission error and does nothing else", async () => {
        const interaction = mockInteraction({ userId: "123" });

        await command.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.embeds[0].title).toBe("Fehlende Berechtigung");
    });

    it("replies with the auction overview title for an admin", async () => {
        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.embeds[0].title).toBe("Auktionsübersicht");
        // botReply called with ephemeral=false, timeout=0
        expect(arg.ephemeral).toBe(false);
    });
});
