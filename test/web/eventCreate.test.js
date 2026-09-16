jest.mock("fs", () => {
    const store = new Map();
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => store.set(p, String(data))),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw new Error("ENOENT");
            return store.get(p);
        }),
    };
});
const mockCreateEvent = jest.fn();
const mockGetEvent = jest.fn();
jest.mock("../../src/utils/raidhelperClient", () => ({
    createRaidhelperClient: () => ({ createEvent: mockCreateEvent, getEvent: mockGetEvent }),
}));
jest.mock("../../src/web/discord", () => ({
    getChannelCategoryMap: jest.fn(() => ({})),
    duplicateChannel: jest.fn(),
}));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/eventMessage", () => ({ postEventMessage: jest.fn() }));
jest.mock("../../src/web/raidEventStore", () => ({ getRaidEvent: jest.fn(() => null), listRaidEvents: jest.fn(() => []) }));
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 1),
}));
jest.mock("../../src/web/raidListing", () => ({
    raidContentIds: ({ title }) => ({ contentIds: /kara/i.test(title || "") ? ["kara"] : [], sources: [] }),
}));

const fs = require("fs");
const discord = require("../../src/web/discord");
const { getConfig } = require("../../src/web/settingsStore");
const { postEventMessage } = require("../../src/web/eventMessage");
const eventStore = require("../../src/web/eventStore");
const { createEvent, startTimeOf } = require("../../src/web/eventCreate");

const user = { id: "42" };
const body = (over = {}) => ({
    title: "Kara Donnerstag", date: "2026-10-01", time: "20:00", templateId: "t1", leaderId: "7", channelId: "c1", description: "Treffpunkt Eingang", ...over,
});

describe("web/eventCreate", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.__store.clear();
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara-do", categoryId: "cat-rh", categoryName: "Raid-Helper-Raids" },
            c2: { name: "kara-fr", categoryId: "cat-eh", categoryName: "EventHelper-Raids" },
        });
        getConfig.mockReturnValue({ categorySignupSource: { "cat-eh": "eventhelper" } });
        postEventMessage.mockResolvedValue({ channelId: "c2", messageId: "m1" });
    });

    it("reads date and time in Berlin time", () => {
        expect(startTimeOf("01-10-2026", "20:00")).toBe(Math.floor(Date.UTC(2026, 9, 1, 18, 0) / 1000));
        expect(startTimeOf("01-10-2026", "kaputt")).toBe(0);
    });

    it("creates the event at Raid-Helper in a category that was not switched", async () => {
        mockCreateEvent.mockResolvedValue({ id: "rh-1" });
        const result = await createEvent({ guildId: "g1", user, body: body() });
        expect(mockCreateEvent).toHaveBeenCalledWith({
            channelId: "c1", leaderId: "7", templateId: "t1", date: "01-10-2026", time: "20:00", title: "Kara Donnerstag", description: "Treffpunkt Eingang",
        });
        expect(result).toEqual({ status: 201, body: { id: "rh-1" } });
        expect(eventStore.listEvents("g1")).toEqual([]);
        expect(postEventMessage).not.toHaveBeenCalled();
    });

    it("creates the event in the own store in an EventHelper category and posts the message", async () => {
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2" }) });
        expect(mockCreateEvent).not.toHaveBeenCalled();
        expect(result.status).toBe(201);
        expect(result.body).toMatchObject({ source: "eventhelper", messageError: null });
        const stored = eventStore.getEvent(result.body.id);
        expect(stored).toMatchObject({
            guildId: "g1", channelId: "c2", channelName: "kara-fr", categoryId: "cat-eh", categoryName: "EventHelper-Raids",
            title: "Kara Donnerstag", leaderId: "7", startTime: startTimeOf("01-10-2026", "20:00"),
            // instances read from the title, size and tanks/healers from the rule set
            versionId: "tbc", instanceIds: ["kara"], size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
            createdBy: "42",
        });
        expect(postEventMessage).toHaveBeenCalledWith(result.body.id);
    });

    it("accepts the planning fields for an EventHelper event", async () => {
        const result = await createEvent({ guildId: "g1", user, body: body({
            channelId: "c2", versionId: "tbc", instanceIds: ["gruul", "mag"], size: 25,
            composition: { tank: 4, healer: 7 }, signupDeadline: startTimeOf("01-10-2026", "12:00"), fairness: true,
        }) });
        expect(eventStore.getEvent(result.body.id)).toMatchObject({
            instanceIds: ["gruul", "mag"], size: 25, composition: { tank: 4, healer: 7 }, fairness: true, wishes: false,
        });
    });

    it("refuses a bad plan before it clones a channel", async () => {
        eventStore.createEvent({ guildId: "g1", channelId: "c2", categoryId: "cat-eh", title: "Alt", startTime: 1900000000 });
        const source = eventStore.listEvents("g1")[0];
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", sourceEventId: source.id, channelName: "neu", size: 99 }) });
        expect(result.error).toMatchObject({ status: 400, code: "invalid_plan" });
        expect(discord.duplicateChannel).not.toHaveBeenCalled();
    });

    it("clones the channel of an own source event and keeps its category's source", async () => {
        const { event: source } = eventStore.createEvent({ guildId: "g1", channelId: "c2", categoryId: "cat-eh", title: "Kara alt", startTime: 1900000000 });
        discord.duplicateChannel.mockResolvedValue({ id: "c3", name: "kara-neu" });
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", sourceEventId: source.id, channelName: "kara-neu" }) });
        expect(mockGetEvent).not.toHaveBeenCalled();
        expect(discord.duplicateChannel).toHaveBeenCalledWith("c2", "kara-neu");
        expect(eventStore.getEvent(result.body.id)).toMatchObject({ channelId: "c3", channelName: "kara-neu", categoryId: "cat-eh" });
    });

    it("still creates the event when the message cannot be posted, and says so", async () => {
        postEventMessage.mockRejectedValue(new Error("Bot nicht verbunden."));
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2" }) });
        expect(result.status).toBe(201);
        expect(result.body.messageError).toBe("Bot nicht verbunden.");
        expect(eventStore.getEvent(result.body.id)).not.toBeNull();
    });

    it("rejects a missing date or channel for both sources", async () => {
        expect((await createEvent({ guildId: "g1", user, body: body({ date: "x" }) })).error.code).toBe("invalid_date");
        expect((await createEvent({ guildId: "g1", user, body: body({ channelId: "" }) })).error.code).toBe("no_channel");
        expect((await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", time: "" }) })).error.code).toBe("invalid_time");
        expect((await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", title: " " }) })).error.code).toBe("invalid_title");
    });

    it("reports Raid-Helper's refusal", async () => {
        mockCreateEvent.mockResolvedValue({ status: "failed", reason: "invalid token" });
        const result = await createEvent({ guildId: "g1", user, body: body() });
        expect(result.error).toEqual({ status: 400, code: "create_failed", message: "invalid token" });
    });
});
