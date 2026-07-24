const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/utils/helper.js");

const helper = require("../../../src/utils/helper.js");
const updateEvents = require("../../../src/commands/setup/updateEvents.js");

describe("commands/setup/updateEvents", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        helper.showAllEvents.mockResolvedValue("formatted raids");
    });

    it("exports the correct command contract", () => {
        expect(updateEvents.name).toBe("update-events");
        expect(typeof updateEvents.description).toBe("string");
        expect(typeof updateEvents.execute).toBe("function");
    });

    it("matches the button custom id it is wired to", () => {
        // createOverview.js registers a button with customId "update-events"
        expect(updateEvents.name).toBe("update-events");
    });

    it("replies with an error when the channel has no parent category", async () => {
        const interaction = mockInteraction({ channel: { id: "c1", parent: null } });

        await updateEvents.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].content).toMatch(/Kategorie/);
        expect(interaction.update).not.toHaveBeenCalled();
        expect(helper.showAllEvents).not.toHaveBeenCalled();
    });

    it("updates the message embed with the refreshed events", async () => {
        const interaction = mockInteraction({
            channel: { id: "c1", parent: { id: "cat-1", name: "GDKP Raids" } },
        });

        await updateEvents.execute(interaction, {});

        expect(helper.showAllEvents).toHaveBeenCalledWith(interaction, "cat-1");
        expect(interaction.update).toHaveBeenCalledTimes(1);
        const embed = interaction.update.mock.calls[0][0].embeds[0];
        expect(embed.title).toBe("GDKP Raids");
        expect(embed.description).toBe("formatted raids");
    });
});
