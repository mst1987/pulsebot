jest.mock("../../../src/utils/auction.js");

const command = require("../../../src/commands/auction/bidCustom.js");
const { showBidModal, bidForLegendary } = require("../../../src/utils/auction.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

// Flush pending microtasks so the .then() callback attached to awaitModalSubmit runs.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("commands/auction/bidCustom", () => {
    it("exports name/description/execute with correct name", () => {
        expect(command).toEqual(
            expect.objectContaining({
                name: "bid-custom",
                description: expect.any(String),
                execute: expect.any(Function),
            })
        );
    });

    it("shows the bid modal", async () => {
        const interaction = mockInteraction();
        interaction.awaitModalSubmit = jest.fn().mockResolvedValue(
            mockInteraction({ options: { bidAmount: "300000" } })
        );

        await command.execute(interaction, {});
        await flush();

        expect(showBidModal).toHaveBeenCalledWith(interaction);
    });

    it("forwards a valid parsed bid amount to bidForLegendary", async () => {
        const client = { id: "client" };
        const interaction = mockInteraction();
        const modalInteraction = mockInteraction({
            options: { bidAmount: "300000" },
        });
        interaction.awaitModalSubmit = jest
            .fn()
            .mockResolvedValue(modalInteraction);

        await command.execute(interaction, client);
        await flush();

        expect(bidForLegendary).toHaveBeenCalledTimes(1);
        expect(bidForLegendary).toHaveBeenCalledWith(client, modalInteraction, 300000);
    });

    it("rejects a non-numeric input and does not bid", async () => {
        const interaction = mockInteraction();
        const modalInteraction = mockInteraction({
            options: { bidAmount: "not-a-number" },
        });
        interaction.awaitModalSubmit = jest
            .fn()
            .mockResolvedValue(modalInteraction);

        await command.execute(interaction, {});
        await flush();

        expect(bidForLegendary).not.toHaveBeenCalled();
        // NOTE: the source replies on the original `interaction`, not on the
        // resolved `modalInteraction`.
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: "Bitte gib eine gültige Zahl ein.",
            })
        );
    });
});
