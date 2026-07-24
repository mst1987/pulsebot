jest.mock("../../../src/utils/auction.js");

const command = require("../../../src/commands/auction/bid.js");
const { bidForLegendary } = require("../../../src/utils/auction.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

describe("commands/auction/bid", () => {
    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "bid",
                description: expect.any(String),
                execute: expect.any(Function),
            })
        );
    });

    it("forwards the raw 'gold' option to bidForLegendary", async () => {
        const client = { id: "client" };
        const interaction = mockInteraction({ options: { gold: "500000" } });

        await command.execute(interaction, client);

        expect(interaction.options.getString).toHaveBeenCalledWith("gold");
        expect(bidForLegendary).toHaveBeenCalledTimes(1);
        expect(bidForLegendary).toHaveBeenCalledWith(client, interaction, "500000");
    });
});
