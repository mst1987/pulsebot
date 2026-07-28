const mockFetchEvents = jest.fn();
const mockGetAllEvents = jest.fn();
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({ fetchEvents: mockFetchEvents, getAllEvents: mockGetAllEvents })));
jest.mock("../../src/web/discord", () => ({ getChannelCategoryMap: jest.fn() }));
jest.mock("../../src/web/raidEventStore", () => ({ listRaidEvents: jest.fn() }));

const discord = require("../../src/web/discord");
const { listRaidEvents } = require("../../src/web/raidEventStore");
const { loadEventGroups, _resetEventsCacheForTests } = require("../../src/web/raidEventGroups");

const event = (over = {}) => ({
    id: "e1", title: "Kara", startTime: 2000000000, channelId: "chan1", leaderId: "u1",
    templateId: 3, description: "desc", signUps: [{ userId: "1", specName: "Fire" }],
    ...over,
});

describe("web/raidEventGroups", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        _resetEventsCacheForTests();
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([]);
        mockFetchEvents.mockResolvedValue([]);
        mockGetAllEvents.mockResolvedValue([]);
    });

    it("returns empty groups without any network call when there is no guild", async () => {
        const result = await loadEventGroups("");
        expect(result).toEqual({ groups: [], error: null, stale: false });
        expect(mockFetchEvents).not.toHaveBeenCalled();
        expect(mockGetAllEvents).not.toHaveBeenCalled();
    });

    it("uses getAllEvents (upcoming) when no sinceSeconds is given", async () => {
        await loadEventGroups("g1");
        expect(mockGetAllEvents).toHaveBeenCalledTimes(1);
        expect(mockFetchEvents).not.toHaveBeenCalled();
    });

    it("uses fetchEvents with the given lower bound when sinceSeconds is given", async () => {
        await loadEventGroups("g1", { sinceSeconds: 12345 });
        expect(mockFetchEvents).toHaveBeenCalledWith(12345);
        expect(mockGetAllEvents).not.toHaveBeenCalled();
    });

    it("groups a live event by its Discord channel's category", async () => {
        mockGetAllEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({
            chan1: { name: "kara-signup", categoryId: "cat1", categoryName: "Raids" },
        });

        const { groups, error, stale } = await loadEventGroups("g1");

        expect(error).toBeNull();
        expect(stale).toBe(false);
        expect(groups).toEqual([{
            categoryId: "cat1", categoryName: "Raids",
            events: [{
                id: "e1", title: "Kara", startTime: 2000000000, leaderId: "u1",
                channelId: "chan1", channelName: "kara-signup", categoryId: "cat1",
                templateId: "3", description: "desc", signupCount: 1,
                signUps: [{ userId: "1", specName: "Fire" }], signUpsFromSnapshot: false,
            }],
        }]);
    });

    it("trusts Raid-Helper's own start-time filtering — no extra client-side filter", async () => {
        // Real production events are far-future unix seconds, but callers only ever
        // pass what Raid-Helper already returned for their StartTimeFilter — this
        // must not re-filter (a prior version of this cache broke on exactly that).
        mockFetchEvents.mockResolvedValue([event({ startTime: 100 })]);
        discord.getChannelCategoryMap.mockReturnValue({ chan1: { name: "c", categoryId: "cat1", categoryName: "Raids" } });

        const { groups } = await loadEventGroups("g1", { sinceSeconds: 999999999 });

        expect(groups[0].events.map((e) => e.id)).toEqual(["e1"]);
    });

    it("falls back to the persisted snapshot for an event whose Discord channel is gone", async () => {
        mockGetAllEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({}); // channel deleted — not in the live map
        listRaidEvents.mockReturnValue([{
            id: "e1", guildId: "g1", title: "Kara", channelId: "chan1", channelName: "kara-signup (gone)",
            categoryId: "cat1", categoryName: "Raids", startTime: 2000000000,
        }]);

        const { groups, error, stale } = await loadEventGroups("g1");

        expect(error).toBeNull();
        expect(stale).toBe(false);
        expect(groups).toEqual([{
            categoryId: "cat1", categoryName: "Raids",
            events: [{
                id: "e1", title: "Kara", startTime: 2000000000, leaderId: "u1",
                channelId: "chan1", channelName: "kara-signup (gone)", categoryId: "cat1",
                templateId: "3", description: "desc", signupCount: 1,
                signUps: [{ userId: "1", specName: "Fire" }], signUpsFromSnapshot: false,
            }],
        }]);
    });

    it("merges in a persisted event Raid-Helper no longer returns live, when a lookback window was requested", async () => {
        // Raid-Helper's own lookback response simply omits the event (pruned on
        // their side, not a deleted channel) — the live fetch itself succeeds.
        mockFetchEvents.mockResolvedValue([]);
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "SSC", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 2000000000,
        }]);

        const { groups, error, stale } = await loadEventGroups("g1", { sinceSeconds: 1 });

        expect(error).toBeNull();
        expect(stale).toBe(false);
        expect(groups).toEqual([{
            categoryId: "cat2", categoryName: "Raids",
            events: [{
                id: "e2", title: "SSC", startTime: 2000000000, leaderId: "",
                channelId: "chan2", channelName: "ssc", categoryId: "cat2",
                templateId: "", description: "", signupCount: 0, signUps: [], signUpsFromSnapshot: false,
            }],
        }]);
    });

    // Raid-Helper keeps listing a finished raid but eventually answers with an
    // empty signup list. Without this fallback the event detail page showed
    // "0 / N Anmeldungen" and counted every expected raider as missing.
    it("restores the roster from the snapshot when the live event lost its signups", async () => {
        mockFetchEvents.mockResolvedValue([event({ signUps: [] })]);
        discord.getChannelCategoryMap.mockReturnValue({
            chan1: { name: "kara-signup", categoryId: "cat1", categoryName: "Raids" },
        });
        listRaidEvents.mockReturnValue([{
            id: "e1", guildId: "g1", title: "Kara", channelId: "chan1", channelName: "kara-signup",
            categoryId: "cat1", categoryName: "Raids", startTime: 2000000000,
            signUps: [{ userId: "1", specName: "Fire" }, { userId: "2", specName: "Absence" }],
        }]);

        const { groups } = await loadEventGroups("g1", { sinceSeconds: 1 });
        const ev = groups[0].events[0];

        expect(ev.signUps).toEqual([{ userId: "1", specName: "Fire" }, { userId: "2", specName: "Absence" }]);
        expect(ev.signupCount).toBe(1); // Absence doesn't count as a signup
        expect(ev.signUpsFromSnapshot).toBe(true);
    });

    it("prefers the live roster over the snapshot", async () => {
        mockFetchEvents.mockResolvedValue([event({ signUps: [{ userId: "9", specName: "Frost" }] })]);
        discord.getChannelCategoryMap.mockReturnValue({
            chan1: { name: "kara-signup", categoryId: "cat1", categoryName: "Raids" },
        });
        listRaidEvents.mockReturnValue([{
            id: "e1", guildId: "g1", title: "Kara", channelId: "chan1", channelName: "kara-signup",
            categoryId: "cat1", categoryName: "Raids", startTime: 2000000000,
            signUps: [{ userId: "1", specName: "Fire" }],
        }]);

        const { groups } = await loadEventGroups("g1", { sinceSeconds: 1 });
        const ev = groups[0].events[0];

        expect(ev.signUps).toEqual([{ userId: "9", specName: "Frost" }]);
        expect(ev.signUpsFromSnapshot).toBe(false);
    });

    it("carries the snapshot roster into a persisted-only event", async () => {
        mockFetchEvents.mockResolvedValue([]);
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "SSC", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 2000000000,
            signUps: [{ userId: "1", specName: "Fire" }, { userId: "2", specName: "Absence" }],
        }]);

        const { groups } = await loadEventGroups("g1", { sinceSeconds: 1 });
        const ev = groups[0].events[0];

        expect(ev.signupCount).toBe(1);
        expect(ev.signUpsFromSnapshot).toBe(true);
    });

    it("does not resurrect old persisted events into a plain upcoming (no sinceSeconds) call", async () => {
        mockGetAllEvents.mockResolvedValue([]);
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "SSC", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 2000000000,
        }]);

        const { groups } = await loadEventGroups("g1");

        expect(groups).toEqual([]);
    });

    it("drops an event that is neither in the live channel map nor ever persisted", async () => {
        mockGetAllEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([]);

        const { groups } = await loadEventGroups("g1");

        expect(groups).toEqual([]);
    });

    it("caches the raw event list — a second call within the TTL skips the network", async () => {
        mockGetAllEvents.mockResolvedValue([event()]);
        await loadEventGroups("g1");
        await loadEventGroups("g1");
        expect(mockGetAllEvents).toHaveBeenCalledTimes(1);
    });

    it("keeps separate cache entries for the upcoming and since-lookback request shapes", async () => {
        await loadEventGroups("g1");
        await loadEventGroups("g1", { sinceSeconds: 12345 });
        expect(mockGetAllEvents).toHaveBeenCalledTimes(1);
        expect(mockFetchEvents).toHaveBeenCalledTimes(1);
    });

    it("re-fetches once the cache TTL has elapsed", async () => {
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        await loadEventGroups("g1");
        nowSpy.mockReturnValue(1_000_000 + 31_000); // > 30s TTL
        await loadEventGroups("g1");
        expect(mockGetAllEvents).toHaveBeenCalledTimes(2);
        nowSpy.mockRestore();
    });

    it("serves the last good result (marked stale) when a fresh fetch fails after a prior success", async () => {
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        mockGetAllEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({ chan1: { name: "c", categoryId: "cat1", categoryName: "Raids" } });
        await loadEventGroups("g1"); // populates lastGood

        nowSpy.mockReturnValue(1_000_000 + 31_000); // force past the TTL so the next call re-fetches
        mockGetAllEvents.mockRejectedValue(new Error("Raid-Helper down"));

        const { groups, error, stale } = await loadEventGroups("g1");

        expect(stale).toBe(true);
        expect(error).toBeNull(); // the live fetch technically "succeeded" via the stale fallback
        expect(groups[0].events.map((e) => e.id)).toEqual(["e1"]);
        nowSpy.mockRestore();
    });

    it("falls back to the persisted store entirely when Raid-Helper fails and there is no cache at all", async () => {
        mockFetchEvents.mockRejectedValue(new Error("Raid-Helper down"));
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "SSC", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 2000000000,
        }]);

        const { groups, error, stale } = await loadEventGroups("g1", { sinceSeconds: 1 });

        expect(error).toBe("Raid-Helper down");
        expect(stale).toBe(true);
        expect(groups).toEqual([{
            categoryId: "cat2", categoryName: "Raids",
            events: [{
                id: "e2", title: "SSC", startTime: 2000000000, leaderId: "",
                channelId: "chan2", channelName: "ssc", categoryId: "cat2",
                templateId: "", description: "", signupCount: 0, signUps: [], signUpsFromSnapshot: false,
            }],
        }]);
    });

    it("returns an empty result with the error when Raid-Helper fails and nothing was ever persisted", async () => {
        mockGetAllEvents.mockRejectedValue(new Error("Raid-Helper down"));
        listRaidEvents.mockReturnValue([]);

        const { groups, error, stale } = await loadEventGroups("g1");

        expect(groups).toEqual([]);
        expect(error).toBe("Raid-Helper down");
        expect(stale).toBe(true);
    });

    it("does not resurrect a persisted event that is older than the requested sinceSeconds", async () => {
        mockFetchEvents.mockRejectedValue(new Error("down"));
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "Old raid", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 100,
        }]);

        const { groups } = await loadEventGroups("g1", { sinceSeconds: 500 });

        expect(groups).toEqual([]);
    });

    it("groups events with no category as \"Ohne Kategorie\"", async () => {
        mockGetAllEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({ chan1: { name: "c", categoryId: "", categoryName: "" } });

        const { groups } = await loadEventGroups("g1");

        expect(groups).toEqual([expect.objectContaining({ categoryId: "", categoryName: "Ohne Kategorie" })]);
    });
});
