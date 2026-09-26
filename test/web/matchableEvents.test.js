const mockGetPastEvents = jest.fn();
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({ getPastEvents: mockGetPastEvents })));
jest.mock("../../src/services/discord/discord", () => ({ getChannelCategoryMap: jest.fn() }));
jest.mock("../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn() }));
jest.mock("../../src/stores/eventStore", () => ({
    listEvents: jest.fn(() => []), getEvent: jest.fn(), isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
jest.mock("../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []) }));
jest.mock("../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const eventStore = require("../../src/stores/eventStore");
const { autoMatches } = require("../../src/web/logEventMatch");
const discord = require("../../src/services/discord/discord");
const { listRaidEvents } = require("../../src/stores/raidEventStore");
const { loadMatchableEvents, eventLinkFields } = require("../../src/web/matchableEvents");
const { event: baseEvent } = require("../factories/events");

const event = (over = {}) => baseEvent({ channelId: "chan1", ...over });

describe("web/matchableEvents", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([]);
        mockGetPastEvents.mockResolvedValue([]);
    });

    it("returns empty result without any network call when there is no guild", async () => {
        const result = await loadMatchableEvents("");
        expect(result).toEqual({ events: [], error: null });
        expect(mockGetPastEvents).not.toHaveBeenCalled();
    });

    it("places a live event via its Discord channel's category", async () => {
        mockGetPastEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({
            chan1: { name: "kara-signup", categoryId: "cat1", categoryName: "Raids" },
        });

        const { events, error } = await loadMatchableEvents("g1");

        expect(error).toBeNull();
        expect(events).toEqual([{
            id: "e1", source: "raidhelper", title: "Kara", startTime: 2000000000, channelId: "chan1",
            channelName: "kara-signup", categoryId: "cat1", categoryName: "Raids",
        }]);
    });

    // Regression test: a past raid's signup channel getting deleted/archived
    // after the fact used to make loadMatchableEvents() silently drop the
    // event, so assigning a detected log or a pasted WCL link to it always
    // failed with "Event nicht gefunden" — even though the event detail page
    // (loadEventGroups(), which has this same fallback) resolved it fine.
    it("falls back to the persisted snapshot for an event whose Discord channel is gone", async () => {
        mockGetPastEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({}); // channel deleted — not in the live map
        listRaidEvents.mockReturnValue([{
            id: "e1", guildId: "g1", title: "Kara", channelId: "chan1", channelName: "kara-signup (gone)",
            categoryId: "cat1", categoryName: "Raids", startTime: 2000000000,
        }]);

        const { events, error } = await loadMatchableEvents("g1");

        expect(error).toBeNull();
        expect(events).toEqual([{
            id: "e1", source: "raidhelper", title: "Kara", startTime: 2000000000, channelId: "chan1",
            channelName: "kara-signup (gone)", categoryId: "cat1", categoryName: "Raids",
        }]);
    });

    // Regression test: an event Raid-Helper's own past-events response simply
    // omits (pruned on their side, not a deleted Discord channel — the live
    // fetch itself succeeds and returns other events) used to make this event
    // unassignable ("Event nicht gefunden") even though the event detail page
    // (loadEventGroups(), which already merges in persisted-but-not-live
    // events for a lookback query) resolved it fine.
    it("merges in a persisted event Raid-Helper no longer returns live", async () => {
        mockGetPastEvents.mockResolvedValue([]); // live fetch succeeds but omits the event
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "SSC", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 2000000000,
        }]);

        const { events, error } = await loadMatchableEvents("g1");

        expect(error).toBeNull();
        expect(events).toEqual([{
            id: "e2", source: "raidhelper", title: "SSC", startTime: 2000000000, channelId: "chan2",
            channelName: "ssc", categoryId: "cat2", categoryName: "Raids",
        }]);
    });

    it("does not resurrect a persisted event that is older than the lookback window", async () => {
        mockGetPastEvents.mockResolvedValue([]);
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([{
            id: "e2", guildId: "g1", title: "Old raid", channelId: "chan2", channelName: "ssc",
            categoryId: "cat2", categoryName: "Raids", startTime: 1,
        }]);

        const { events } = await loadMatchableEvents("g1", 1);

        expect(events).toEqual([]);
    });

    it("drops an event that is neither in the live channel map nor ever persisted", async () => {
        mockGetPastEvents.mockResolvedValue([event()]);
        discord.getChannelCategoryMap.mockReturnValue({});
        listRaidEvents.mockReturnValue([]);

        const { events } = await loadMatchableEvents("g1");

        expect(events).toEqual([]);
    });

    it("sorts events newest start first", async () => {
        mockGetPastEvents.mockResolvedValue([
            event({ id: "old", startTime: 100, channelId: "c-old" }),
            event({ id: "new", startTime: 999999, channelId: "c-new" }),
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            "c-old": { name: "old", categoryId: "cat1", categoryName: "Raids" },
            "c-new": { name: "new", categoryId: "cat1", categoryName: "Raids" },
        });

        const { events } = await loadMatchableEvents("g1");

        expect(events.map((e) => e.id)).toEqual(["new", "old"]);
    });

    it("returns an empty result with the error when Raid-Helper fails and nothing is persisted", async () => {
        mockGetPastEvents.mockRejectedValue(new Error("Raid-Helper down"));

        const { events, error } = await loadMatchableEvents("g1");

        expect(events).toEqual([]);
        expect(error).toBe("Raid-Helper down");
    });

    // The automatic log->event assignment (logAutoLink.js) runs off this list.
    // Returning nothing during an outage would stall it until Raid-Helper is
    // back, even though the snapshot holds everything a time match needs.
    it("serves the persisted snapshot when Raid-Helper fails, keeping the error", async () => {
        mockGetPastEvents.mockRejectedValue(new Error("Raid-Helper down"));
        listRaidEvents.mockReturnValue([
            { id: "e1", guildId: "g1", title: "Kara", channelId: "chan1", channelName: "kara",
                categoryId: "cat1", categoryName: "Raids", startTime: 2000000000 },
            { id: "e2", guildId: "g1", title: "SSC", channelId: "chan2", channelName: "ssc",
                categoryId: "cat1", categoryName: "Raids", startTime: 2000009999 },
        ]);

        const { events, error } = await loadMatchableEvents("g1");

        expect(error).toBe("Raid-Helper down");
        expect(events.map((e) => e.id)).toEqual(["e2", "e1"]); // newest first
        expect(events[1]).toEqual({
            id: "e1", source: "raidhelper", title: "Kara", startTime: 2000000000, channelId: "chan1",
            channelName: "kara", categoryId: "cat1", categoryName: "Raids",
        });
    });

    it("does not serve snapshot events older than the lookback window during an outage", async () => {
        mockGetPastEvents.mockRejectedValue(new Error("Raid-Helper down"));
        listRaidEvents.mockReturnValue([{
            id: "old", guildId: "g1", title: "Ancient", channelId: "c", channelName: "c",
            categoryId: "cat1", categoryName: "Raids", startTime: 1,
        }]);

        const { events } = await loadMatchableEvents("g1", 1);

        expect(events).toEqual([]);
    });

    describe("with the EventHelper's own raids", () => {
        const START = Math.floor(Date.now() / 1000) - 3600; // an hour ago
        const own = {
            id: "eh-1", source: "eventhelper", guildId: "g1", categoryId: "cat1", categoryName: "Raids",
            channelId: "chan9", channelName: "kara-eh", title: "Kara EH", startTime: START,
        };
        afterEach(() => eventStore.listEvents.mockReturnValue([]));

        it("offers them next to Raid-Helper's, newest first, and a log matches one by time", async () => {
            mockGetPastEvents.mockResolvedValue([event({ startTime: START - 3 * 86400 })]);
            discord.getChannelCategoryMap.mockReturnValue({ chan1: { name: "kara", categoryId: "cat1", categoryName: "Raids" } });
            eventStore.listEvents.mockReturnValue([own]);

            const { events } = await loadMatchableEvents("g1");

            expect(events.map((e) => [e.id, e.source])).toEqual([["eh-1", "eventhelper"], ["e1", "raidhelper"]]);
            // the window: from the lookback up to now
            expect(eventStore.listEvents).toHaveBeenCalledWith("g1", expect.objectContaining({ sinceSeconds: expect.any(Number), untilSeconds: expect.any(Number) }));
            const pairs = autoMatches([{ id: "l1", postedAt: (START + 600) * 1000 }], events);
            expect(pairs.map((p) => [p.log.id, p.event.id])).toEqual([["l1", "eh-1"]]);
        });

        it("still offers them while Raid-Helper is down", async () => {
            mockGetPastEvents.mockRejectedValue(new Error("down"));
            eventStore.listEvents.mockReturnValue([own]);

            const { events, error } = await loadMatchableEvents("g1");

            expect(error).toBe("down");
            expect(events.map((e) => e.id)).toEqual(["eh-1"]);
        });
    });
});

describe("web/matchableEvents eventLinkFields", () => {
    it("builds the stored link fields from an event, preferring its title over its id", () => {
        expect(eventLinkFields({ id: "e1", title: "Kara", startTime: "123" }, "manual")).toEqual({
            eventId: "e1", eventLabel: "Kara", eventStartTime: 123, source: "manual",
        });
    });

    it("falls back to the event id as the label when it has no title", () => {
        expect(eventLinkFields({ id: "e1", startTime: 0 }, "auto")).toEqual({
            eventId: "e1", eventLabel: "e1", eventStartTime: 0, source: "auto",
        });
    });
});
