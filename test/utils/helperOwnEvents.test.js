// #291: the bot's channel/category lookups with own events and a Raid-Helper
// that does not answer. The web stores and Raid-Helper are mocked.
const mockRh = { getAllEvents: jest.fn() };
jest.mock("../../src/utils/raidhelper/client", () => ({ createRaidhelperClient: () => mockRh }));
jest.mock("../../src/web/eventSources", () => ({
    ownUpcomingRaw: jest.fn(() => []),
}));

const eventSources = require("../../src/web/eventSources");
const { getCategoryEvents } = require("../../src/utils/helper");
const { mockInteraction } = require("../helpers/mockInteraction.js");

describe("utils/helper with own events (#291)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventSources.ownUpcomingRaw.mockReturnValue([]);
        jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => console.error.mockRestore());

    it("getCategoryEvents keeps the own events when Raid-Helper fails", async () => {
        mockRh.getAllEvents.mockRejectedValue(new Error("HTTP 404"));
        eventSources.ownUpcomingRaw.mockReturnValue([{ id: "eh-1", categoryId: "cat-1", channelId: "x", startTime: 5 }]);
        const interaction = mockInteraction();
        await expect(getCategoryEvents(interaction, "cat-1")).resolves.toEqual([{ id: "eh-1", categoryId: "cat-1", channelId: "x", startTime: 5 }]);
    });
});
