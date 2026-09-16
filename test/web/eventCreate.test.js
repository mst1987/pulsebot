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
jest.mock("../../src/web/discordChannels", () => ({
    createFromTemplate: jest.fn(),
    discordErrorText: jest.requireActual("../../src/web/discordChannels").discordErrorText,
}));
jest.mock("../../src/web/settingsStore",() => ({ getConfig: jest.fn(() => ({})), getRaidTemplate: jest.fn(() => null) }));
jest.mock("../../src/web/eventMessage", () => ({ postEventMessage: jest.fn() }));
jest.mock("../../src/web/talkOverview", () => ({ scheduleOverviewSync: jest.fn(), RAIDHELPER_CREATE_DELAY_MS: 35000 }));
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
const discordChannels = require("../../src/web/discordChannels");
const { getConfig, getRaidTemplate } = require("../../src/web/settingsStore");
const { postEventMessage } = require("../../src/web/eventMessage");
const { scheduleOverviewSync } = require("../../src/web/talkOverview");
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
        expect(result).toEqual({ status: 201, body: { id: "rh-1", channelId: "c1" } });
        expect(scheduleOverviewSync).toHaveBeenCalledWith({ delayMs: 35000 });
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
        expect(scheduleOverviewSync).toHaveBeenCalledWith();
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

    it("takes what the body leaves open from the category's default raid template", async () => {
        getConfig.mockReturnValue({ categorySignupSource: { "cat-eh": "eventhelper" }, categoryRaidTemplate: { "cat-eh": "tpl-t5" } });
        getRaidTemplate.mockImplementation((id) => (id === "tpl-t5" ? {
            id: "tpl-t5", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25,
            composition: { tank: 3, healer: 7, melee: { min: 4, max: null }, ranged: null },
            signupDeadline: { hoursBefore: 24 }, fairness: true, wishes: false,
        } : null));
        try {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", title: "Donnerstag", size: 20 }) });
            const start = startTimeOf("01-10-2026", "20:00");
            expect(eventStore.getEvent(result.body.id)).toMatchObject({
                instanceIds: ["ssc", "tk"], size: 20, composition: { tank: 3, healer: 7, melee: 4, ranged: 0 },
                signupDeadline: start - 24 * 3600, fairness: true, wishes: false,
            });
        } finally {
            getRaidTemplate.mockReturnValue(null);
        }
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

    it("creates a new channel in the asked category, only after the plan was checked (#260)", async () => {
        discordChannels.createFromTemplate.mockResolvedValue({ id: "c9", name: "mi-24-09-kara" });
        const bad = await createEvent({ guildId: "g1", user, body: body({
            channelId: "", newChannel: { name: "Mi 24 09 Kara", categoryId: "cat-eh" }, size: 99,
        }) });
        expect(bad.error.code).toBe("invalid_plan");
        expect(discordChannels.createFromTemplate).not.toHaveBeenCalled();

        const result = await createEvent({ guildId: "g1", user, body: body({
            channelId: "", newChannel: { name: "Mi 24 09 Kara", categoryId: "cat-eh", templateChannelId: "c2" },
        }) });
        expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("g1", { name: "mi-24-09-kara", parentId: "cat-eh", templateChannelId: "c2" });
        expect(eventStore.getEvent(result.body.id)).toMatchObject({ channelId: "c9", channelName: "mi-24-09-kara", categoryId: "cat-eh" });
    });

    it("reports a new channel Discord refused, readable", async () => {
        discordChannels.createFromTemplate.mockRejectedValue(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", newChannel: { name: "kara", categoryId: "cat-rh" } }) });
        expect(result.error).toEqual({ status: 400, code: "create_failed", message: "Kanal konnte nicht angelegt werden: fehlende Rechte" });
        expect(mockCreateEvent).not.toHaveBeenCalled();
    });

    it("lets the caller pick the other source for one event", async () => {
        mockCreateEvent.mockResolvedValue({ id: "rh-2" });
        const rh = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", signupSource: "raidhelper" }) });
        expect(rh.body).toEqual({ id: "rh-2", channelId: "c2" });
        const own = await createEvent({ guildId: "g1", user, body: body({ channelId: "c1", signupSource: "eventhelper" }) });
        expect(own.body.source).toBe("eventhelper");
        const ignored = await createEvent({ guildId: "g1", user, body: body({ channelId: "c1", signupSource: "kaputt" }) });
        expect(ignored.body).toEqual({ id: "rh-2", channelId: "c1" });
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
