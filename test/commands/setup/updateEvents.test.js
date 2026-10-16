const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { cardText } = require("../../helpers/cardText.js");

jest.mock("../../../src/services/events/raidOverview.js");
jest.mock("../../../src/stores/raidOverviewStore.js");

const raidOverview = require("../../../src/services/events/raidOverview.js");
const store = require("../../../src/stores/raidOverviewStore.js");
const updateEvents = require("../../../src/commands/setup/updateEvents.js");

describe("commands/setup/updateEvents", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        raidOverview.adoptMessage.mockResolvedValue({ overview: {} });
        raidOverview.refreshOverviews.mockResolvedValue({ edited: 1, removed: 0, failed: 0, unchanged: 0 });
        store.listOverviews.mockReturnValue([]);
    });

    it("exports the correct command contract", () => {
        expect(updateEvents.name).toBe("update-events");
        expect(typeof updateEvents.description).toBe("string");
        expect(typeof updateEvents.execute).toBe("function");
    });

    it("matches the button custom id the old overview messages carry", () => {
        expect(updateEvents.name).toBe("update-events");
    });

    it("replies with an error when the channel has no parent category", async () => {
        const interaction = mockInteraction({ channel: { id: "c1", parent: null } });

        await updateEvents.execute(interaction, {});

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(cardText(interaction.reply.mock.calls[0][0])).toMatch(/Kategorie/);
        expect(raidOverview.adoptMessage).not.toHaveBeenCalled();
    });

    it("turns the old overview a button was clicked on into a self-updating one", async () => {
        const interaction = mockInteraction({
            customId: "update-events",
            message: { id: "old-msg" },
            channel: { id: "c1", parent: { id: "cat-1", name: "GDKP Raids" } },
        });

        await updateEvents.execute(interaction, {});

        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(raidOverview.adoptMessage).toHaveBeenCalledWith({ guildId: "guild-1", channelId: "c1", messageId: "old-msg", categoryId: "cat-1" });
        expect(interaction.update).not.toHaveBeenCalled();
    });

    it("as a slash command redraws the overviews of the category", async () => {
        store.listOverviews.mockReturnValue([
            { categoryId: "cat-1", messageId: "m1" }, { categoryId: "cat-2", messageId: "m2" }, { categoryId: "cat-1", messageId: "m3" },
        ]);
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1" } } });

        await updateEvents.execute(interaction, {});

        expect(raidOverview.refreshOverviews.mock.calls.map((c) => c[0].messageId)).toEqual(["m1", "m3"]);
        expect(raidOverview.refreshOverviews).toHaveBeenCalledWith(expect.objectContaining({ onlyStale: false }));
        expect(cardText(interaction.reply.mock.calls[0][0])).toContain("neu gezeichnet");
    });

    it("points to /createoverview when the category has no overview yet", async () => {
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1" } } });
        await updateEvents.execute(interaction, {});
        expect(raidOverview.refreshOverviews).not.toHaveBeenCalled();
        expect(cardText(interaction.reply.mock.calls[0][0])).toContain("/createoverview");
    });
});
