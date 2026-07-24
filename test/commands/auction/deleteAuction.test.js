jest.mock("../../../src/classes/legendary.js");

const command = require("../../../src/commands/auction/deleteAuction.js");
const Legendary = require("../../../src/classes/legendary.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { adminUserId } = require("../../../src/config/variables.js");

describe("commands/auction/deleteAuction", () => {
    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "deleteauction",
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

    it("confirms deletion on success", async () => {
        const deleteAuction = jest
            .fn()
            .mockResolvedValue({ type: "success", message: "weg damit" });
        Legendary.mockImplementation(() => ({ deleteAuction }));
        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, {});

        expect(deleteAuction).toHaveBeenCalledWith("channel-1");
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.embeds[0].title).toBe("Auktion gelöscht");
        expect(arg.embeds[0].description).toBe("weg damit");
    });

    it("reports an error on a non-success response", async () => {
        Legendary.mockImplementation(() => ({
            deleteAuction: jest.fn().mockResolvedValue({ type: "error" }),
        }));
        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, {});

        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("Fehler");
    });
});
