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

    it("is admin-only unless the Bot-Befehle settings say otherwise", () => {
        // The check itself runs centrally before execute (src/web/botAccess.js).
        expect(command.defaultAccess).toBe("admins");
        expect(typeof command.group).toBe("string");
    });

    it("replies with the auction overview title for an admin", async () => {
        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.embeds[0].title).toBe("Auktionsübersicht");
        // botReply called non-ephemeral (no flags), timeout=0
        expect(arg.flags).toBeUndefined();
    });
});
