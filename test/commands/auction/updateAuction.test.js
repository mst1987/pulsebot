jest.mock("../../../src/classes/legendary.js");
jest.mock("../../../src/utils/responses.js");

const command = require("../../../src/commands/auction/updateAuction.js");
const Legendary = require("../../../src/classes/legendary.js");
const { getAuctionMessage } = require("../../../src/utils/responses.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { adminUserId } = require("../../../src/config/variables.js");

describe("commands/auction/updateAuction", () => {
    beforeEach(() => {
        getAuctionMessage.mockReturnValue("AUCTION MESSAGE");
    });

    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "updateauction",
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

    it("updates the auction, edits the message and confirms on success", async () => {
        const updateAuction = jest.fn().mockResolvedValue({
            type: "success",
            legendary: { messageid: "msg-1" },
        });
        Legendary.mockImplementation(() => ({ updateAuction }));

        const targetMessage = { edit: jest.fn().mockResolvedValue(undefined) };
        const client = {
            channels: {
                fetch: jest.fn().mockResolvedValue({
                    messages: {
                        fetch: jest.fn().mockResolvedValue(targetMessage),
                    },
                }),
            },
        };

        const interaction = mockInteraction({
            userId: adminUserId,
            options: { name: "Dragonwrath", mingold: "300000" },
        });

        await command.execute(interaction, client);

        expect(updateAuction).toHaveBeenCalledTimes(1);
        const payload = updateAuction.mock.calls[0][0];
        expect(payload).toEqual(
            expect.objectContaining({
                channel: "channel-1",
                name: "Dragonwrath",
                mingold: "300000",
            })
        );
        expect(targetMessage.edit).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe(
            "Auktion updated"
        );
    });

    it("reports an error on a non-success response", async () => {
        Legendary.mockImplementation(() => ({
            updateAuction: jest.fn().mockResolvedValue({ type: "error" }),
        }));
        const interaction = mockInteraction({ userId: adminUserId });

        await command.execute(interaction, {});

        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("Fehler");
    });
});
