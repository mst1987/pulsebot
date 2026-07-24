jest.mock("../../../src/utils/auction.js");
jest.mock("../../../src/classes/legendary.js");

const command = require("../../../src/commands/auction/bid10k.js");
const { bidForLegendary } = require("../../../src/utils/auction.js");
const Legendary = require("../../../src/classes/legendary.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

describe("commands/auction/bid10k", () => {
    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "bid-10k",
                description: expect.any(String),
                execute: expect.any(Function),
            })
        );
    });

    it("adds 10000 to the current highest bid", async () => {
        Legendary.mockImplementation(() => ({
            getHighestBid: jest.fn().mockResolvedValue({ gold: "250000" }),
        }));
        const client = { id: "client" };
        const interaction = mockInteraction();

        await command.execute(interaction, client);

        expect(bidForLegendary).toHaveBeenCalledTimes(1);
        expect(bidForLegendary).toHaveBeenCalledWith(client, interaction, 260000);
    });

    it("falls back to 250000 when there is no highest bid", async () => {
        Legendary.mockImplementation(() => ({
            getHighestBid: jest.fn().mockResolvedValue(null),
        }));
        const client = { id: "client" };
        const interaction = mockInteraction();

        await command.execute(interaction, client);

        expect(bidForLegendary).toHaveBeenCalledTimes(1);
        expect(bidForLegendary).toHaveBeenCalledWith(client, interaction, 250000);
    });
});
