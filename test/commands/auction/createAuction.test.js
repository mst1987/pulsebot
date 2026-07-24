jest.mock("../../../src/classes/legendary.js");
jest.mock("../../../src/utils/auction.js");
jest.mock("../../../src/utils/responses.js");

const command = require("../../../src/commands/auction/createAuction.js");
const Legendary = require("../../../src/classes/legendary.js");
const { getBiddingButtonRow } = require("../../../src/utils/auction.js");
const { getAuctionMessage } = require("../../../src/utils/responses.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { adminUserId } = require("../../../src/config/variables.js");

const auctionOptions = {
    name: "Dragonwrath",
    raid: "Firelands",
    endtime: "24.07.26-20:00",
    mingold: "250000",
    increment: "5000",
};

function adminInteraction(extra = {}) {
    const targetMessage = { edit: jest.fn().mockResolvedValue(undefined) };
    const interaction = mockInteraction({
        userId: adminUserId,
        options: auctionOptions,
    });
    interaction.channel = {
        id: "channel-1",
        parent: { id: "category-1" },
        messages: { fetch: jest.fn().mockResolvedValue(targetMessage) },
    };
    interaction._targetMessage = targetMessage;
    return Object.assign(interaction, extra);
}

describe("commands/auction/createAuction", () => {
    beforeEach(() => {
        getBiddingButtonRow.mockReturnValue({ row: true });
        getAuctionMessage.mockReturnValue("AUCTION MESSAGE");
    });

    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "createauction",
                description: expect.any(String),
                execute: expect.any(Function),
            })
        );
    });

    it("blocks a non-admin user", async () => {
        const interaction = mockInteraction({ userId: "123" });

        await command.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe(
            "Fehlende Berechtigung"
        );
        // Legendary must never be constructed for a non-admin.
        expect(Legendary).not.toHaveBeenCalled();
    });

    it("refuses to create when an auction already exists for the channel", async () => {
        Legendary.mockImplementation(() => ({
            getAuction: jest.fn().mockResolvedValue({ id: "existing" }),
            createAuction: jest.fn(),
        }));
        const interaction = adminInteraction();

        await command.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe(
            "Auktion Info"
        );
    });

    it("creates the auction and edits the message on success", async () => {
        const createAuction = jest.fn().mockResolvedValue({
            type: "success",
            legendary: { name: "Dragonwrath" },
        });
        Legendary.mockImplementation(() => ({
            getAuction: jest.fn().mockResolvedValue(null),
            createAuction,
        }));
        const interaction = adminInteraction();

        await command.execute(interaction, {});

        // Posts the initial embed with the bidding button row.
        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(createAuction).toHaveBeenCalledTimes(1);
        const payload = createAuction.mock.calls[0][0];
        expect(payload).toEqual(
            expect.objectContaining({
                name: "Dragonwrath",
                raid: "Firelands",
                channel: "channel-1",
                mingold: "250000",
                increment: "5000",
            })
        );
        // Message is edited to the "Auktion gestartet" embed.
        expect(interaction._targetMessage.edit).toHaveBeenCalledTimes(1);
    });

    it("follows up when the API responds with a non-success", async () => {
        Legendary.mockImplementation(() => ({
            getAuction: jest.fn().mockResolvedValue(null),
            createAuction: jest
                .fn()
                .mockResolvedValue({ type: "error", message: "kaputt" }),
        }));
        const interaction = adminInteraction();

        await command.execute(interaction, {});

        expect(interaction.followUp).toHaveBeenCalledTimes(1);
    });

    it("follows up with an error message when createAuction throws", async () => {
        Legendary.mockImplementation(() => ({
            getAuction: jest.fn().mockResolvedValue(null),
            createAuction: jest.fn().mockRejectedValue(new Error("boom")),
        }));
        const interaction = adminInteraction();

        await command.execute(interaction, {});

        expect(interaction.followUp).toHaveBeenCalledTimes(1);
        expect(interaction.followUp.mock.calls[0][0].embeds[0].description).toBe(
            "Fehler beim Erstellen der Auktion"
        );
    });
});
