const mockGetPastEvents = jest.fn();
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({ getPastEvents: mockGetPastEvents })));

const mockGetChannelCategoryMap = jest.fn(() => ({}));
const mockListGuilds = jest.fn(() => []);
jest.mock("../../src/web/discord", () => ({
    getChannelCategoryMap: (...a) => mockGetChannelCategoryMap(...a),
    listGuilds: (...a) => mockListGuilds(...a),
}));

const mockSaveRaidEvents = jest.fn(() => 0);
jest.mock("../../src/web/raidEventStore", () => ({ saveRaidEvents: (...a) => mockSaveRaidEvents(...a) }));

const { scanRaidEvents, scanAllGuilds, startRaidEventScan } = require("../../src/web/raidEventScan.js");
const { RECENT_WINDOW_DAYS } = require("../../src/web/recentEvents.js");

describe("web/raidEventScan", () => {
    const NOW = 1_700_000_000_000;
    let nowSpy;

    beforeEach(() => {
        nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
        mockGetPastEvents.mockReset().mockResolvedValue([]);
        mockGetChannelCategoryMap.mockReset().mockReturnValue({});
        mockListGuilds.mockReset().mockReturnValue([]);
        mockSaveRaidEvents.mockReset().mockReturnValue(0);
    });
    afterEach(() => nowSpy.mockRestore());

    describe("scanRaidEvents", () => {
        it("does nothing for a blank guild id", async () => {
            expect(await scanRaidEvents("")).toEqual({ scanned: 0, error: null });
            expect(mockGetPastEvents).not.toHaveBeenCalled();
        });

        it("asks Raid-Helper for events since the lookback window", async () => {
            await scanRaidEvents("g1");
            expect(mockGetPastEvents).toHaveBeenCalledWith(Math.floor(NOW / 1000) - RECENT_WINDOW_DAYS * 86400);
        });

        it("honours a custom window", async () => {
            await scanRaidEvents("g1", { windowDays: 7 });
            expect(mockGetPastEvents).toHaveBeenCalledWith(Math.floor(NOW / 1000) - 7 * 86400);
        });

        it("snapshots each in-guild event's channel and category name into the store", async () => {
            mockGetPastEvents.mockResolvedValue([
                { id: "e1", channelId: "c1", title: "Kara", startTime: 100 },
            ]);
            mockGetChannelCategoryMap.mockReturnValue({
                c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
            });
            const result = await scanRaidEvents("g1");
            expect(mockSaveRaidEvents).toHaveBeenCalledWith([{
                id: "e1", guildId: "g1", title: "Kara",
                channelId: "c1", channelName: "kara", categoryId: "cat", categoryName: "Raids", startTime: 100,
            }]);
            expect(result).toEqual({ scanned: 1, error: null });
        });

        it("drops events whose channel is not in this guild", async () => {
            mockGetPastEvents.mockResolvedValue([
                { id: "e1", channelId: "elsewhere", title: "Fremd", startTime: 100 },
            ]);
            mockGetChannelCategoryMap.mockReturnValue({});
            const result = await scanRaidEvents("g1");
            expect(mockSaveRaidEvents).toHaveBeenCalledWith([]);
            expect(result.scanned).toBe(0);
        });

        it("reports a Raid-Helper failure instead of throwing", async () => {
            mockGetPastEvents.mockRejectedValue(new Error("API kaputt"));
            const result = await scanRaidEvents("g1");
            expect(result).toEqual({ scanned: 0, error: "API kaputt" });
            expect(mockSaveRaidEvents).not.toHaveBeenCalled();
        });
    });

    describe("scanAllGuilds", () => {
        it("scans every guild the bot is a member of", async () => {
            mockListGuilds.mockReturnValue([{ id: "g1", name: "G1" }, { id: "g2", name: "G2" }]);
            mockGetPastEvents.mockResolvedValue([{ id: "e1", channelId: "c1", title: "Kara", startTime: 100 }]);
            mockGetChannelCategoryMap.mockReturnValue({ c1: { name: "kara" } });
            const total = await scanAllGuilds();
            expect(mockSaveRaidEvents).toHaveBeenCalledTimes(2);
            expect(total).toBe(2);
        });

        it("keeps scanning the remaining guilds when one fails", async () => {
            mockListGuilds.mockReturnValue([{ id: "g1", name: "G1" }, { id: "g2", name: "G2" }]);
            mockGetPastEvents
                .mockRejectedValueOnce(new Error("g1 down"))
                .mockResolvedValueOnce([{ id: "e1", channelId: "c1", title: "Kara", startTime: 100 }]);
            mockGetChannelCategoryMap.mockReturnValue({ c1: { name: "kara" } });
            const total = await scanAllGuilds();
            expect(total).toBe(1);
        });
    });

    describe("startRaidEventScan", () => {
        it("scans once immediately and returns a timer", () => {
            const timer = startRaidEventScan({ intervalMs: 60000 });
            expect(mockListGuilds).toHaveBeenCalled();
            expect(timer).toBeTruthy();
            clearInterval(timer);
        });
    });
});
