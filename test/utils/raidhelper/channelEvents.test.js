// The events of a category (#291): own events and a Raid-Helper that does not
// answer. The web stores and Raid-Helper are mocked.
const mockRh = { getAllEvents: jest.fn() };
jest.mock("../../../src/utils/raidhelper/client", () => ({ createRaidhelperClient: () => mockRh }));
jest.mock("../../../src/services/events/eventSources", () => ({
    ownUpcomingRaw: jest.fn(() => []),
}));

const eventSources = require("../../../src/services/events/eventSources");
const {
    getCategoryEvents,
    getChannelsFromCategories,
} = require("../../../src/utils/raidhelper/channelEvents");
const { mockInteraction, makeCollection } = require("../../helpers/mockInteraction.js");

const channels = [
    ["c1", { id: "c1", type: 0, parent: { id: "cat-1" } }],
    ["c2", { id: "c2", type: 0, parent: { id: "cat-2" } }],
    ["v1", { id: "v1", type: 2, parent: { id: "cat-1" } }],
    ["top", { id: "top", type: 0, parent: null }],
];

describe("utils/raidhelper/channelEvents", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventSources.ownUpcomingRaw.mockReturnValue([]);
        jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => console.error.mockRestore());

    it("getChannelsFromCategories returns the text channels under the given categories", () => {
        const guild = { channels: { cache: makeCollection(channels) } };
        expect(getChannelsFromCategories(guild, ["cat-1"])).toEqual(["c1"]);
    });

    it("getCategoryEvents keeps the own events when Raid-Helper fails (#291)", async () => {
        mockRh.getAllEvents.mockRejectedValue(new Error("HTTP 404"));
        eventSources.ownUpcomingRaw.mockReturnValue([{ id: "eh-1", categoryId: "cat-1", channelId: "x", startTime: 5 }]);
        const interaction = mockInteraction();
        await expect(getCategoryEvents(interaction, "cat-1")).resolves.toEqual([{ id: "eh-1", categoryId: "cat-1", channelId: "x", startTime: 5 }]);
    });

    it("getCategoryEvents merges both sources of the category, soonest first", async () => {
        mockRh.getAllEvents.mockResolvedValue([
            { id: "rh-1", channelId: "c1", startTime: 30 },
            { id: "rh-2", channelId: "c2", startTime: 10 },
        ]);
        eventSources.ownUpcomingRaw.mockReturnValue([
            { id: "eh-1", channelId: "c1", startTime: 20 },
            { id: "eh-2", categoryId: "cat-2", channelId: "c2", startTime: 1 },
        ]);
        const interaction = mockInteraction({ channels });
        const events = await getCategoryEvents(interaction, "cat-1");
        expect(events.map((e) => e.id)).toEqual(["eh-1", "rh-1"]);
        expect(eventSources.ownUpcomingRaw).toHaveBeenCalledWith("guild-1");
    });

    it("getCategoryEvents leaves out the raids of a hidden version (#563)", async () => {
        const spy = jest.spyOn(require("../../../src/stores/configStore"), "getConfig").mockReturnValue({ mainVersion: "tbc", hideOtherVersions: true });
        try {
            mockRh.getAllEvents.mockResolvedValue([
                { id: "rh-1", channelId: "c1", startTime: 30, versionId: "forever" },
                { id: "rh-3", channelId: "c1", startTime: 5, versionId: "tbc" },
            ]);
            eventSources.ownUpcomingRaw.mockReturnValue([
                { id: "eh-1", channelId: "c1", startTime: 20, versionId: "tbc" },
                { id: "eh-2", channelId: "c1", startTime: 25, versionId: "forever" },
            ]);
            const events = await getCategoryEvents(mockInteraction({ channels }), "cat-1");
            expect(events.map((e) => e.id)).toEqual(["rh-3", "eh-1"]);
            spy.mockReturnValue({ mainVersion: "tbc" });
            expect((await getCategoryEvents(mockInteraction({ channels }), "cat-1")).map((e) => e.id)).toEqual(["rh-3", "eh-1", "eh-2", "rh-1"]);
        } finally {
            spy.mockRestore();
        }
    });
});
