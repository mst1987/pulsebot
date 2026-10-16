const mockListEvents = jest.fn(() => []);
const mockAppendEventLog = jest.fn();
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: (...a) => mockListEvents(...a),
    appendEventLog: (...a) => mockAppendEventLog(...a),
}));

let mockSnapshot = { events: [] };
jest.mock("../../../src/stores/raidhelperEventsStore", () => ({ readSnapshot: () => mockSnapshot }));

const mockGetSoftres = jest.fn(() => null);
const mockSetLink = jest.fn();
jest.mock("../../../src/stores/eventSoftresStore", () => ({
    getEventSoftres: (...a) => mockGetSoftres(...a),
    setEventSoftresLink: (...a) => mockSetLink(...a),
}));

const mockLootSystemOf = jest.fn(() => ({ softres: true }));
jest.mock("../../../src/stores/eventLootSystemStore", () => ({ lootSystemOf: (...a) => mockLootSystemOf(...a) }));

const mockFetchTextChannel = jest.fn();
jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: () => [{ id: "g1" }],
    getChannelCategoryMap: () => ({ c1: { categoryId: "cat1" } }),
    fetchTextChannel: (...a) => mockFetchTextChannel(...a),
}));

const sd = require("../../../src/services/loot/softresDetect");

const NOW = 1_700_000_000_000;
const HOUR = 3600;
const nowSec = Math.floor(NOW / 1000);
const URL1 = "https://softres.it/raid/abc123";

function msg(over = {}) {
    return {
        guild: { id: "g1" },
        channelId: "c1",
        client: { user: { id: "bot" } },
        author: { id: "u1", username: "lead" },
        member: { displayName: "Lead" },
        content: "list: " + URL1,
        embeds: [],
        createdTimestamp: NOW,
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockListEvents.mockReturnValue([]);
    mockSnapshot = { events: [] };
    mockGetSoftres.mockReturnValue(null);
    mockLootSystemOf.mockReturnValue({ softres: true });
});

describe("extractSoftresUrls", () => {
    it("finds links in content, normalises and dedupes", () => {
        const urls = sd.extractSoftresUrls("a https://softres.it/raid/abc123/tok and http://www.softres.it/raid/abc123 and https://softres.it/raid/zzz9");
        expect(urls).toEqual([URL1, "https://softres.it/raid/zzz9"]);
    });

    it("reads embeds (url, title, description, fields)", () => {
        const urls = sd.extractSoftresUrls({
            content: "",
            embeds: [{ title: "x", url: "https://softres.it/raid/e1", description: "see https://softres.it/raid/e2", fields: [{ name: "n", value: "https://softres.it/raid/e3" }] }],
        });
        expect(urls).toEqual(["https://softres.it/raid/e1", "https://softres.it/raid/e2", "https://softres.it/raid/e3"]);
    });

    it("ignores other links", () => {
        expect(sd.extractSoftresUrls("https://example.com/raid/abc https://softres.it/")).toEqual([]);
    });
});

describe("onMessage", () => {
    const own = (id, startOffsetSec, extra = {}) => ({ id, channelId: "c1", startTime: nowSec + startOffsetSec, categoryId: "cat1", ...extra });

    it("ignores DMs, its own messages and messages without a link", () => {
        mockListEvents.mockReturnValue([own("ev1", HOUR)]);
        expect(sd.onMessage(msg({ guild: null })).reason).toBe("dm");
        expect(sd.onMessage(msg({ author: { id: "bot" } })).reason).toBe("self");
        expect(sd.onMessage(msg({ content: "hi" })).reason).toBe("no-link");
        expect(mockSetLink).not.toHaveBeenCalled();
    });

    it("links the soonest not-yet-over own event and logs it", () => {
        mockListEvents.mockReturnValue([own("late", 48 * HOUR), own("past", -10 * HOUR), own("soon", 5 * HOUR), own("other", HOUR, { channelId: "c2" })]);
        const r = sd.onMessage(msg());
        expect(r).toEqual({ linked: true, eventId: "soon", url: URL1 });
        expect(mockSetLink).toHaveBeenCalledWith("soon", { url: URL1, editUrl: URL1 });
        expect(mockAppendEventLog).toHaveBeenCalledWith("soon", expect.objectContaining({ action: "softresLinked", byName: "Lead", detail: URL1 }));
    });

    it("still counts a raid that started less than 6 h ago", () => {
        mockListEvents.mockReturnValue([own("running", -2 * HOUR)]);
        expect(sd.onMessage(msg()).eventId).toBe("running");
    });

    it("ignores a past event and a cancelled one", () => {
        mockListEvents.mockReturnValue([own("past", -10 * HOUR), own("gone", HOUR, { status: "cancelled" })]);
        expect(sd.onMessage(msg()).reason).toBe("no-event");
    });

    it("maps Raid-Helper events from the synced list, no event log", () => {
        mockSnapshot = { events: [{ id: "rh1", channelId: "c1", startTime: nowSec + 3 * HOUR }, { id: "rh0", channelId: "c1", startTime: nowSec - 30 * HOUR }] };
        mockListEvents.mockReturnValue([own("ev9", 30 * HOUR)]);
        const r = sd.onMessage(msg());
        expect(r.eventId).toBe("rh1");
        expect(mockAppendEventLog).not.toHaveBeenCalled();
    });

    it("never overwrites a record that already has a url", () => {
        mockListEvents.mockReturnValue([own("ev1", HOUR)]);
        mockGetSoftres.mockReturnValue({ eventId: "ev1", url: "https://softres.it/raid/old" });
        expect(sd.onMessage(msg())).toEqual({ linked: false, reason: "has-list", eventId: "ev1" });
        expect(mockSetLink).not.toHaveBeenCalled();
    });
});

describe("backfill", () => {
    const channel = (messages) => ({ messages: { fetch: jest.fn(async () => new Map(messages.map((m, i) => [String(i), m]))) } });
    const ev = (id, offset, extra = {}) => ({ id, channelId: "c1", startTime: nowSec + offset, categoryId: "cat1", ...extra });

    it("links the newest posted list of a softres raid without one", async () => {
        mockListEvents.mockReturnValue([ev("ev1", 5 * HOUR)]);
        mockFetchTextChannel.mockResolvedValue(channel([
            msg({ content: "https://softres.it/raid/older", createdTimestamp: NOW - 5000 }),
            msg({ content: "https://softres.it/raid/newer", createdTimestamp: NOW - 1000 }),
            msg({ content: "chat" }),
        ]));
        const r = await sd.backfill({ now: NOW });
        expect(r.linked).toEqual([{ eventId: "ev1", url: "https://softres.it/raid/newer" }]);
        expect(mockFetchTextChannel).toHaveBeenCalledTimes(1);
    });

    it("skips raids that have a list, do not use softres, or lie too far ahead", async () => {
        mockListEvents.mockReturnValue([ev("hasList", HOUR, { channelId: "c1" })]);
        mockGetSoftres.mockReturnValue({ url: "https://softres.it/raid/x" });
        expect((await sd.backfill({ now: NOW })).checked).toBe(0);

        mockGetSoftres.mockReturnValue(null);
        mockLootSystemOf.mockReturnValue({ softres: false });
        expect((await sd.backfill({ now: NOW })).checked).toBe(0);

        mockLootSystemOf.mockReturnValue({ softres: true });
        mockListEvents.mockReturnValue([]);
        mockSnapshot = { events: [{ id: "rhFar", channelId: "c1", startTime: nowSec + 30 * 86400 }] };
        expect((await sd.backfill({ now: NOW })).checked).toBe(0);
        expect(mockFetchTextChannel).not.toHaveBeenCalled();
    });

    it("also covers Raid-Helper events and survives an unreadable channel", async () => {
        mockSnapshot = { events: [{ id: "rh1", channelId: "c1", startTime: nowSec + 2 * HOUR }] };
        mockFetchTextChannel.mockRejectedValue(new Error("Missing Access"));
        const r = await sd.backfill({ now: NOW });
        expect(r).toEqual({ checked: 1, linked: [] });
        expect(mockLootSystemOf).toHaveBeenCalledWith("rh1", "cat1");
    });

    it("ignores messages older than two weeks", async () => {
        mockListEvents.mockReturnValue([ev("ev1", HOUR)]);
        mockFetchTextChannel.mockResolvedValue(channel([msg({ createdTimestamp: NOW - 20 * 86400000 })]));
        expect((await sd.backfill({ now: NOW })).linked).toEqual([]);
    });
});

describe("start/stop", () => {
    it("starts one unref'd timer and stops it", () => {
        jest.useFakeTimers();
        const t = sd.startSoftresDetect({ intervalMs: 1000, firstDelayMs: 10 });
        expect(sd.startSoftresDetect()).toBe(t);
        sd.stopSoftresDetect();
        expect(jest.getTimerCount()).toBe(0);
        jest.useRealTimers();
    });
});
