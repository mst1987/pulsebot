// The raid overviews of the categories (services/events/raidOverview.js): posting, hash-based
// redraws, the deleted-message rule, the adoption scan of old overviews and the timers.
// Discord, the event data and the other stores are mocked; the overview store is real.
const mockEventListeners = new Set();
const mockSignupListeners = new Set();
let mockGroups = [];
let mockGroupsError = null;

jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(),
    editPayload: jest.fn(),
    getClient: jest.fn(),
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: mockGroups, error: mockGroupsError })),
}));
jest.mock("../../../src/services/signups/availabilityPanel", () => ({ categoryNameFor: jest.fn(() => "Fallback Name") }));
jest.mock("../../../src/services/talk/talkOverview", () => ({ attendingCount: (e) => (e.signUps || []).length }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: () => ({ discordServers: { eventGuilds: [{ guildId: "g1" }, { guildId: "g2" }] }, categoryLanguage: { cat1: "en" } }),
}));
jest.mock("../../../src/stores/eventStore", () => ({
    onEventsChanged: (fn) => {
        mockEventListeners.add(fn);
        return () => mockEventListeners.delete(fn);
    },
}));
jest.mock("../../../src/stores/signupStore", () => ({
    onSignupsChanged: (fn) => {
        mockSignupListeners.add(fn);
        return () => mockSignupListeners.delete(fn);
    },
}));
jest.mock("../../../src/services/events/mainVersion", () => ({
    versionOfEvent: (e) => e.versionId || "tbc",
    visibleRows: (rows, versionOf) => rows.filter((r) => versionOf(r) !== "hidden"),
}));
jest.mock("../../../src/logger", () => {
    const log = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
    return { ...log, child: () => log };
});

const { DateTime } = require("luxon");
const discord = require("../../../src/services/discord/discord");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const logger = require("../../../src/logger").child();
const store = require("../../../src/stores/raidOverviewStore");
const overview = require("../../../src/services/events/raidOverview");
const { cardText } = require("../../helpers/cardText");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = DateTime.fromISO("2026-10-14T12:00:00", { zone: "Europe/Berlin" }).toMillis();
const NOW_SEC = Math.floor(NOW / 1000);
const DAY = 86400;
const unknownMessage = () => Object.assign(new Error("Unknown Message"), { code: 10008 });
const raid = (id, over = {}) => ({ id, title: `Raid ${id}`, startTime: NOW_SEC + 3 * DAY, channelId: `ch-${id}`, leaderId: "lead", size: 25, signUps: [], ...over });
const posted = (messageId = "m1", channelId = "c1") => ({ guildId: "g1", channelId, messageId, url: `https://discord.com/channels/g1/${channelId}/${messageId}` });
const tracked = (over = {}) => store.setOverview({ guildId: "g1", channelId: "c1", messageId: "m1", categoryId: "cat1", hash: "", lastChange: 0, ...over });

afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("raid-overviews.json"));
    mockGroups = [{ categoryId: "cat1", categoryName: "🔥 PUG Raids", events: [raid("a"), raid("b", { startTime: NOW_SEC + 9 * DAY })] }];
    mockGroupsError = null;
    discord.isOnline.mockReturnValue(true);
});

describe("services/events/raidOverview", () => {
    describe("postOverview", () => {
        it("posts the card in the category's language and remembers the message", async () => {
            discord.postPayload.mockResolvedValue(posted());
            const res = await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW });
            expect(res).toMatchObject({ edited: false, url: "https://discord.com/channels/g1/c1/m1" });
            const [channelId, payload] = discord.postPayload.mock.calls[0];
            expect(channelId).toBe("c1");
            const text = cardText(payload);
            expect(text).toContain("## PUG Raids");
            expect(text).toContain("This ID");
            expect(text).toContain("last change");
            expect(loadEventGroups).toHaveBeenCalledWith("g1");
            expect(store.getOverview("m1")).toMatchObject({ guildId: "g1", channelId: "c1", categoryId: "cat1", lastChange: NOW_SEC });
            expect(store.getOverview("m1").hash).toBeTruthy();
        });

        it("speaks German in a category without its own language", async () => {
            mockGroups[0].categoryId = "cat9";
            discord.postPayload.mockResolvedValue(posted());
            await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat9", now: NOW });
            expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("Diese ID");
        });

        it("edits the overview a channel holds of that category instead of posting a second", async () => {
            tracked();
            discord.editPayload.mockResolvedValue({ url: "https://discord.com/channels/g1/c1/m1" });
            const res = await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW });
            expect(res.edited).toBe(true);
            expect(discord.postPayload).not.toHaveBeenCalled();
            expect(discord.editPayload).toHaveBeenCalledWith("c1", "m1", expect.any(Object));
            expect(store.listOverviews()).toHaveLength(1);
        });

        it("posts a new one when the remembered message is gone, and allows another channel", async () => {
            tracked();
            discord.editPayload.mockRejectedValue(unknownMessage());
            discord.postPayload.mockResolvedValue(posted("m2"));
            await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW });
            expect(store.listOverviews().map((o) => o.messageId)).toEqual(["m2"]);
            discord.postPayload.mockResolvedValue(posted("m3", "c2"));
            await overview.postOverview({ guildId: "g1", channelId: "c2", categoryId: "cat1", now: NOW });
            expect(store.listOverviews().map((o) => o.messageId).sort()).toEqual(["m2", "m3"]);
        });

        it("reports a failed post and an unloadable event list without remembering anything", async () => {
            discord.postPayload.mockRejectedValue(new Error("Missing Access"));
            expect(await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW })).toEqual({ error: "Missing Access" });
            mockGroupsError = "Raid-Helper down";
            expect(await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW })).toEqual({ error: "Raid-Helper down" });
            expect(await overview.postOverview({ guildId: "g1", channelId: "c1" })).toEqual({ error: "No category." });
            expect(await overview.postOverview({ guildId: "g1", categoryId: "cat1" })).toEqual({ error: "No channel." });
            expect(store.listOverviews()).toEqual([]);
        });

        it("leaves out the raids of a hidden version", async () => {
            mockGroups[0].events = [raid("a", { versionId: "hidden", title: "Hidden Raid" }), raid("b", { title: "Shown Raid" })];
            discord.postPayload.mockResolvedValue(posted());
            await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW });
            const text = cardText(discord.postPayload.mock.calls[0][1]);
            expect(text).toContain("Shown Raid");
            expect(text).not.toContain("Hidden Raid");
        });
    });

    describe("refreshOverviews", () => {
        it("edits a stale overview once and then leaves it alone while nothing changed", async () => {
            tracked();
            discord.editPayload.mockResolvedValue({});
            expect(await overview.refreshOverviews({ now: NOW })).toEqual({ edited: 1, removed: 0, failed: 0, unchanged: 0 });
            expect(cardText(discord.editPayload.mock.calls[0][2])).toContain("last change");
            expect(store.getOverview("m1")).toMatchObject({ lastChange: NOW_SEC });

            // a later sweep: same content, so no edit - and the footer time is not touched
            expect(await overview.refreshOverviews({ now: NOW + 600000 })).toEqual({ edited: 0, removed: 0, failed: 0, unchanged: 1 });
            expect(discord.editPayload).toHaveBeenCalledTimes(1);
            expect(store.getOverview("m1").lastChange).toBe(NOW_SEC);
        });

        it("redraws when a signup changed the content, with the new time in the footer", async () => {
            tracked();
            discord.editPayload.mockResolvedValue({});
            await overview.refreshOverviews({ now: NOW });
            mockGroups[0].events[0].signUps = [{ userId: "u1" }];
            const later = NOW + 600000;
            expect((await overview.refreshOverviews({ now: later })).edited).toBe(1);
            expect(cardText(discord.editPayload.mock.calls[1][2])).toContain("1 / 25 signed up");
            expect(store.getOverview("m1").lastChange).toBe(Math.floor(later / 1000));
        });

        it("redraws everything with onlyStale off, or just one message", async () => {
            tracked();
            tracked({ messageId: "m2", channelId: "c2" });
            discord.editPayload.mockResolvedValue({});
            await overview.refreshOverviews({ now: NOW });
            expect(discord.editPayload).toHaveBeenCalledTimes(2);
            await overview.refreshOverviews({ now: NOW, onlyStale: false, messageId: "m2" });
            expect(discord.editPayload).toHaveBeenCalledTimes(3);
            expect(discord.editPayload).toHaveBeenLastCalledWith("c2", "m2", expect.any(Object));
        });

        it("forgets a message deleted in Discord - and does not post it again", async () => {
            tracked();
            discord.editPayload.mockRejectedValue(unknownMessage());
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ removed: 1, failed: 0 });
            expect(store.listOverviews()).toEqual([]);
            expect(discord.postPayload).not.toHaveBeenCalled();
        });

        it("keeps the message on any other failure and says so only once", async () => {
            tracked();
            discord.editPayload.mockRejectedValue(new Error("Channel nicht gefunden."));
            expect((await overview.refreshOverviews({ now: NOW })).failed).toBe(1);
            expect((await overview.refreshOverviews({ now: NOW })).failed).toBe(1);
            expect(store.getOverview("m1")).not.toBeNull();
            expect(logger.warn).toHaveBeenCalledTimes(1);
        });

        it("leaves a message as it is while the raids cannot be loaded completely", async () => {
            tracked();
            mockGroupsError = "Raid-Helper down";
            expect((await overview.refreshOverviews({ now: NOW })).failed).toBe(1);
            expect(discord.editPayload).not.toHaveBeenCalled();
        });

        it("loads each event server once per run", async () => {
            tracked();
            tracked({ messageId: "m2", channelId: "c2", categoryId: "cat2" });
            discord.editPayload.mockResolvedValue({});
            await overview.refreshOverviews({ now: NOW });
            expect(loadEventGroups).toHaveBeenCalledTimes(1);
        });

        it("shows a category without raids as 'no raids planned'", async () => {
            tracked({ categoryId: "cat-empty" });
            discord.editPayload.mockResolvedValue({});
            await overview.refreshOverviews({ now: NOW });
            const text = cardText(discord.editPayload.mock.calls[0][2]);
            expect(text).toContain("## Fallback Name");
            expect(text).toContain("Gerade sind keine Raids geplant");
        });
    });

    describe("adoptMessage (a click on an old overview)", () => {
        it("registers the message and draws it in the new design", async () => {
            discord.editPayload.mockResolvedValue({});
            const res = await overview.adoptMessage({ guildId: "g1", channelId: "c1", messageId: "old1", categoryId: "cat1", now: NOW });
            expect(res.overview).toMatchObject({ messageId: "old1", categoryId: "cat1", lastChange: NOW_SEC });
            expect(discord.editPayload).toHaveBeenCalledWith("c1", "old1", expect.any(Object));
        });

        it("tells when it could not be drawn", async () => {
            discord.editPayload.mockRejectedValue(new Error("Missing Access"));
            const res = await overview.adoptMessage({ guildId: "g1", channelId: "c1", messageId: "old1", categoryId: "cat1", now: NOW });
            expect(res.error).toBeTruthy();
            expect(await overview.adoptMessage({ guildId: "g1" })).toEqual({ error: "Incomplete message data." });
        });
    });

    describe("adoptExisting", () => {
        const BOT = "bot-1";
        const msg = (id, over = {}) => ({ id, author: { id: BOT }, components: [], interaction: null, interactionMetadata: null, ...over });
        const col = (list) => new Map(list.map((m) => [m.id, m]));
        const channel = (id, messages, over = {}) => ({
            id, name: `chan-${id}`, type: 0, parentId: `cat-${id}`,
            messages: { fetch: jest.fn(async () => col(messages)) },
            ...over,
        });
        const guildWith = (channels) => ({ channels: { cache: new Map(channels.map((c) => [c.id, c])) } });
        const wait = jest.fn(async () => {});

        beforeEach(() => {
            wait.mockClear();
            discord.getClient.mockReturnValue({ user: { id: BOT } });
            discord.getGuild.mockReturnValue(undefined);
        });

        it("finds the bot's messages of /createoverview, old and new interaction shapes, and the old button", async () => {
            const row = { type: 1, components: [{ type: 2, custom_id: "update-events" }, { type: 2, custom_id: "show-signups" }] };
            const oldButtons = { components: [{ toJSON: () => row }] };
            const c1 = channel("c1", [
                msg("legacy", { interaction: { commandName: "createoverview" } }),
                msg("meta", { interactionMetadata: { name: "createoverview" } }),
                msg("buttons", oldButtons),
                msg("other", { interaction: { commandName: "raids" } }),
                msg("foreign", { author: { id: "someone" }, interaction: { commandName: "createoverview" } }),
                msg("plain"),
            ]);
            discord.getGuild.mockImplementation((id) => (id === "g1" ? guildWith([c1]) : undefined));
            const res = await overview.adoptExisting({ pauseMs: 0, wait });
            expect(res).toMatchObject({ adopted: 3, guilds: 1, failed: 0 });
            expect(store.listOverviews().map((o) => o.messageId).sort()).toEqual(["buttons", "legacy", "meta"]);
            expect(store.getOverview("legacy")).toMatchObject({ guildId: "g1", channelId: "c1", categoryId: "cat-c1", hash: "" });
            expect(c1.messages.fetch).toHaveBeenCalledWith({ limit: 50 });
            expect(store.isScanned("g1")).toBe(true);
        });

        it("searches once only, and pauses between channels", async () => {
            const chans = [channel("c1", []), channel("c2", []), channel("c3", [])];
            discord.getGuild.mockImplementation((id) => (id === "g1" ? guildWith(chans) : undefined));
            await overview.adoptExisting({ pauseMs: 1234, wait });
            expect(wait).toHaveBeenCalledTimes(3);
            expect(wait).toHaveBeenCalledWith(1234);
            await overview.adoptExisting({ pauseMs: 0, wait });
            expect(chans[0].messages.fetch).toHaveBeenCalledTimes(1);
        });

        it("skips voice channels and channels without a category, and does not register a message twice", async () => {
            const voice = channel("v1", [msg("x", { interaction: { commandName: "createoverview" } })], { type: 2 });
            const loose = channel("l1", [msg("y", { interaction: { commandName: "createoverview" } })], { parentId: null });
            const good = channel("c1", [msg("z", { interaction: { commandName: "createoverview" } })]);
            store.setOverview({ guildId: "g1", channelId: "c1", messageId: "z", categoryId: "cat-c1", hash: "keep", lastChange: 5 });
            discord.getGuild.mockImplementation((id) => (id === "g1" ? guildWith([voice, loose, good]) : undefined));
            const res = await overview.adoptExisting({ pauseMs: 0, wait });
            expect(res.adopted).toBe(0);
            expect(voice.messages.fetch).not.toHaveBeenCalled();
            expect(loose.messages.fetch).not.toHaveBeenCalled();
            expect(store.getOverview("z").hash).toBe("keep");
        });

        it("survives a channel it cannot read, adopts the rest and tries that server again next time", async () => {
            const broken = channel("c1", []);
            broken.messages.fetch.mockRejectedValue(new Error("Missing Access"));
            const fine = channel("c2", [msg("ok", { interaction: { commandName: "createoverview" } })]);
            discord.getGuild.mockImplementation((id) => (id === "g1" ? guildWith([broken, fine]) : undefined));
            const res = await overview.adoptExisting({ pauseMs: 0, wait });
            expect(res).toMatchObject({ adopted: 1, failed: 1, guilds: 0 });
            expect(logger.warn).toHaveBeenCalled();
            expect(store.isScanned("g1")).toBe(false);
            broken.messages.fetch.mockResolvedValue(col([]));
            expect((await overview.adoptExisting({ pauseMs: 0, wait })).guilds).toBe(1);
            expect(store.isScanned("g1")).toBe(true);
        });

        it("does nothing while the bot is offline", async () => {
            discord.isOnline.mockReturnValue(false);
            expect(await overview.adoptExisting({ pauseMs: 0, wait })).toEqual({ adopted: 0, guilds: 0, failed: 0 });
            discord.isOnline.mockReturnValue(true);
            discord.getClient.mockReturnValue(null);
            expect(await overview.adoptExisting({ pauseMs: 0, wait })).toEqual({ adopted: 0, guilds: 0, failed: 0 });
            expect(store.isScanned("g1")).toBe(false);
        });
    });

    it("forgets an overview message that was deleted in Discord at once", () => {
        tracked();
        expect(overview.onOverviewMessageDeleted("other")).toBe(false);
        expect(store.listOverviews()).toHaveLength(1);
        expect(overview.onOverviewMessageDeleted("m1")).toBe(true);
        expect(store.listOverviews()).toEqual([]);
    });

    describe("the timers", () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => {
            overview.stopRaidOverviews();
            jest.useRealTimers();
        });

        it("redraws after a change of an event or a signup, collapsed into one run", async () => {
            tracked({ hash: "" });
            discord.editPayload.mockResolvedValue({});
            overview.startRaidOverviews({ firstDelayMs: 1e9, intervalMs: 1e9, nudgeMs: 100 });
            expect(mockEventListeners.size).toBe(1);
            expect(mockSignupListeners.size).toBe(1);
            [...mockEventListeners][0]();
            [...mockSignupListeners][0]();
            [...mockEventListeners][0]();
            await jest.advanceTimersByTimeAsync(150);
            expect(discord.editPayload).toHaveBeenCalledTimes(1);
        });

        it("sweeps after the first delay and then on the interval, adopting old overviews first", async () => {
            tracked({ hash: "x" });
            discord.editPayload.mockResolvedValue({});
            overview.startRaidOverviews({ firstDelayMs: 1000, intervalMs: 5000, nudgeMs: 100 });
            await jest.advanceTimersByTimeAsync(1100);
            expect(discord.getClient).toHaveBeenCalled();
            expect(discord.editPayload).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(5000);
            // the content did not change since: no second edit
            expect(discord.editPayload).toHaveBeenCalledTimes(1);
        });

        it("starts once, stops cleanly and nudges nothing while no overview is remembered", () => {
            expect(overview.scheduleRefresh()).toBeNull();
            const stop = overview.startRaidOverviews({ firstDelayMs: 1e9, intervalMs: 1e9 });
            expect(overview.startRaidOverviews()).toBe(stop);
            stop();
            expect(mockEventListeners.size).toBe(0);
            expect(mockSignupListeners.size).toBe(0);
        });
    });
});
