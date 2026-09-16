// #291: the bot's channel/category lookups with own events and a Raid-Helper
// that does not answer. The web stores and Raid-Helper are mocked.
const mockRh = { getAllEvents: jest.fn(), getEvent: jest.fn(), getSetup: jest.fn() };
jest.mock("../../src/utils/raidhelperClient", () => ({ createRaidhelperClient: () => mockRh }));
jest.mock("../../src/web/eventSources", () => ({
    ownUpcomingRaw: jest.fn(() => []),
    ownEventInChannel: jest.fn(() => null),
}));
jest.mock("../../src/web/setupEditor", () => ({ raidHelperSlots: jest.fn(() => []) }));

const eventSources = require("../../src/web/eventSources");
const { raidHelperSlots } = require("../../src/web/setupEditor");
const { getCategoryEvents, getRaidInfosFromChannel } = require("../../src/utils/helper");
const { mockInteraction, makeCollection } = require("../helpers/mockInteraction.js");

describe("utils/helper with own events (#291)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventSources.ownEventInChannel.mockReturnValue(null);
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

    it("getRaidInfosFromChannel reads the channel's own event with its approved setup, Berlin date and time", async () => {
        eventSources.ownEventInChannel.mockReturnValue({
            id: "eh-7", title: "SSC", description: "Hallo", channelName: "ssc-mi", startTime: Date.UTC(2026, 8, 23, 17, 30) / 1000,
        });
        raidHelperSlots.mockReturnValue([{ id: "u1", name: "Zibbo" }]);
        const channel = { id: "ch-7", messages: { fetch: jest.fn() } };
        const infos = await getRaidInfosFromChannel(mockInteraction({ channel }));
        expect(infos).toEqual({
            raidData: { raidid: "eh-7", title: "SSC", description: "Hallo", raidname: "ssc-mi 23-09-2026", date: "23-09-2026", time: "19:30", isGdkp: true },
            setupData: [{ id: "u1", name: "Zibbo" }],
            source: "eventhelper",
        });
        expect(eventSources.ownEventInChannel).toHaveBeenCalledWith("ch-7");
        expect(channel.messages.fetch).not.toHaveBeenCalled();
        expect(mockRh.getEvent).not.toHaveBeenCalled();
    });

    it("getRaidInfosFromChannel falls back to the Raid-Helper post and answers undefined without one", async () => {
        const { raidhelperBotId } = require("../../src/config/variables");
        mockRh.getEvent.mockResolvedValue({ id: "99", title: "Kara", channelName: "kara", date: "1-1-2026", time: "20:00" });
        mockRh.getSetup.mockResolvedValue({ setup: [{ name: "A" }] });
        const channel = { id: "c", messages: { fetch: jest.fn(async () => makeCollection([["99", { author: { id: raidhelperBotId } }]])) } };
        const infos = await getRaidInfosFromChannel(mockInteraction({ channel }));
        expect(infos.raidData).toMatchObject({ raidid: "99", title: "Kara" });
        expect(infos.setupData).toEqual([{ name: "A" }]);

        const empty = { id: "c", messages: { fetch: jest.fn(async () => makeCollection([])) } };
        await expect(getRaidInfosFromChannel(mockInteraction({ channel: empty }))).resolves.toBeUndefined();
    });
});
