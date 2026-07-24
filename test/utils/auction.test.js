const mockGetAuction = jest.fn();
const mockBid = jest.fn();

jest.mock("../../src/classes/legendary", () =>
    jest.fn().mockImplementation(() => ({
        getAuction: mockGetAuction,
        bid: mockBid,
    }))
);

// Avoid the network side of a successful bid (fetching + editing overview msgs).
jest.mock("../../src/utils/legendary", () => ({
    getTargetMessage: jest.fn().mockResolvedValue(false),
    updateHighestBids: jest.fn(),
}));

const {
    showBidModal,
    showConfirmationModal,
    getBiddingButtonRow,
    bidForLegendary,
} = require("../../src/utils/auction.js");
const { legendaryID, maxBidAmount } = require("../../src/config/variables.js");
const { mockInteraction, makeCollection } = require("../helpers/mockInteraction.js");

// Give the interaction a member with the given roles (interaction.member is not
// part of the base mock helper).
function withRoles(interaction, roleIds) {
    interaction.member = {
        roles: {
            cache: makeCollection(roleIds.map((id) => [id, { id }])),
        },
    };
    interaction.user.tag = "tester#0001";
    return interaction;
}

describe("utils/auction", () => {
    describe("showBidModal", () => {
        it("shows a modal with the bidModal custom id", async () => {
            const interaction = mockInteraction();
            await showBidModal(interaction);
            expect(interaction.showModal).toHaveBeenCalledTimes(1);
            expect(interaction.showModal.mock.calls[0][0].data.custom_id).toBe("bidModal");
        });
    });

    describe("showConfirmationModal", () => {
        // NOTE: BUG in src/utils/auction.js showConfirmationModal — the text-input
        // label `Bist du sicher, dass du ${bid} Gold bieten möchtest?` is already
        // 46+ chars even before the bid is inserted, exceeding Discord's 45-char
        // label limit. discord.js therefore throws for ANY bid value, so this
        // modal can never actually be shown. Asserting current (broken) behavior.
        it("throws because the label exceeds Discord's 45 character limit", async () => {
            const interaction = mockInteraction();
            await expect(showConfirmationModal(interaction, 12345)).rejects.toThrow();
            expect(interaction.showModal).not.toHaveBeenCalled();
        });
    });

    describe("getBiddingButtonRow", () => {
        it("builds a row with the +10k and custom-bid buttons", () => {
            const row = getBiddingButtonRow(mockInteraction());
            const ids = row.components.map((c) => c.data.custom_id);
            expect(ids).toEqual(["bid-10k", "bid-custom"]);
        });
    });

    describe("bidForLegendary", () => {
        it("rejects users without the legendary role", async () => {
            const interaction = withRoles(mockInteraction(), []);
            await bidForLegendary({}, interaction, 1000);
            expect(interaction.reply).toHaveBeenCalledTimes(1);
            expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe(
                "Fehlende Berechtigung"
            );
            expect(mockBid).not.toHaveBeenCalled();
        });

        it("reports when no auction is active in the channel", async () => {
            const interaction = withRoles(mockInteraction(), [legendaryID]);
            mockGetAuction.mockResolvedValueOnce(null);
            await bidForLegendary({}, interaction, 1000);
            expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("Auktion Info");
            expect(mockBid).not.toHaveBeenCalled();
        });

        it("guards against fat-fingered bids above the max", async () => {
            const interaction = withRoles(mockInteraction(), [legendaryID]);
            mockGetAuction.mockResolvedValueOnce({ id: "auction" });
            await bidForLegendary({}, interaction, maxBidAmount + 1);
            expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("Vertippt?");
            expect(mockBid).not.toHaveBeenCalled();
        });

        it("places a successful bid and confirms it", async () => {
            const interaction = withRoles(mockInteraction(), [legendaryID]);
            mockGetAuction.mockResolvedValueOnce({ id: "auction" });
            mockBid.mockResolvedValueOnce({ type: "success" });

            await bidForLegendary({}, interaction, 250000);

            expect(mockBid).toHaveBeenCalledTimes(1);
            expect(mockBid.mock.calls[0][0]).toMatchObject({
                userid: interaction.user.id,
                gold: 250000,
                legendary: interaction.channel.id,
            });
            // Confirmation reply is sent (title is the formatted gold amount).
            expect(interaction.reply).toHaveBeenCalled();
            expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("**250.000g**");
        });

        it("relays a rejected bid message from the API", async () => {
            const interaction = withRoles(mockInteraction(), [legendaryID]);
            mockGetAuction.mockResolvedValueOnce({ id: "auction" });
            mockBid.mockResolvedValueOnce({ type: "error", message: "Zu niedrig" });

            await bidForLegendary({}, interaction, 250000);
            const embed = interaction.reply.mock.calls[0][0].embeds[0];
            expect(embed.title).toBe("Gebot nicht akzeptiert!");
            expect(embed.description).toBe("Zu niedrig");
        });
    });
});
