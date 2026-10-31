// The raid overviews of the categories (services/events/overview/raidOverview.js): posting, hash-based
// redraws, the deleted-message rule, the adoption scan of old overviews and the timers.
// Discord, the event data and the other stores are mocked; the overview store is real.
const mockEventListeners = new Set();
const mockSignupListeners = new Set();
let mockGroups = [];
let mockGroupsError = null;
let mockVisuals = { overviewWeekStrip: false };
let mockServerOverview = {};

jest.mock("../../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(),
    editPayload: jest.fn(),
    getClient: jest.fn(),
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(),
}));
jest.mock("../../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: mockGroups, error: mockGroupsError })),
}));
jest.mock("../../../../src/services/signups/availabilityPanel", () => ({ categoryNameFor: jest.fn(() => "Fallback Name") }));
jest.mock("../../../../src/services/talk/talkOverview", () => ({ attendingCount: (e) => (e.signUps || []).length }));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "g1" }, { guildId: "g2" }], links: [] }, categoryLanguage: { cat1: "en" }, categoryServerOverview: mockServerOverview, discordVisuals: mockVisuals }),
}));
jest.mock("../../../../src/stores/events/eventStore", () => ({
    onEventsChanged: (fn) => {
        mockEventListeners.add(fn);
        return () => mockEventListeners.delete(fn);
    },
}));
jest.mock("../../../../src/stores/events/signupStore", () => ({
    onSignupsChanged: (fn) => {
        mockSignupListeners.add(fn);
        return () => mockSignupListeners.delete(fn);
    },
}));
jest.mock("../../../../src/services/versions/mainVersion", () => ({
    versionOfEvent: (e) => e.versionId || "tbc",
    visibleRows: (rows, versionOf) => rows.filter((r) => versionOf(r) !== "hidden"),
}));
// the real resvg, wrapped so a test can count renders or make one fail
jest.mock("@resvg/resvg-js", () => {
    const actual = jest.requireActual("@resvg/resvg-js");
    return { Resvg: jest.fn((svg, opts) => new actual.Resvg(svg, opts)) };
});
// the real panel; shownRaids wrapped so a test can make the listed raids depend on the language
jest.mock("../../../../src/services/events/overview/raidOverviewPanel", () => {
    const actual = jest.requireActual("../../../../src/services/events/overview/raidOverviewPanel");
    return { ...actual, shownRaids: jest.fn(actual.shownRaids) };
});
jest.mock("../../../../src/logger", () => {
    const log = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
    return { ...log, child: () => log };
});

const { DateTime } = require("luxon");
const discord = require("../../../../src/services/discord/discord");
const { loadEventGroups } = require("../../../../src/services/events/raidEventGroups");
const logger = require("../../../../src/logger").child();
const store = require("../../../../src/stores/events/raidOverviewStore");
const overview = require("../../../../src/services/events/overview/raidOverview");
const { cardText } = require("../../../helpers/cardText");
const { tempStoreFile } = require("../../../helpers/tempStore");

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
    mockVisuals = { overviewWeekStrip: false };
    mockServerOverview = {};
    discord.isOnline.mockReturnValue(true);
});

describe("services/events/overview/raidOverview", () => {
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

    describe("the overview of a whole server (scope server)", () => {
        const twoCategories = () => {
            mockGroups = [
                { categoryId: "cat1", categoryName: "🔥 10er", events: [raid("a", { title: "Karazhan", categoryName: "🔥 10er" }), raid("b", { startTime: NOW_SEC + 9 * DAY, title: "Late Raid", categoryName: "🔥 10er" })] },
                { categoryId: "cat2", categoryName: "40er", events: [raid("c", { startTime: NOW_SEC + DAY, title: "Molten Core", categoryName: "40er" })] },
                { categoryId: "", categoryName: "Ohne Kategorie", events: [raid("d", { title: "Loose Raid" })] },
            ];
        };
        const serverPost = (over = {}) => overview.postOverview({ guildId: "g1", channelId: "c-ov", scope: "server", now: NOW, ...over });

        it("lists the raids of every raid category of the server by time, each with its category, and remembers it as the server's", async () => {
            twoCategories();
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            const res = await serverPost();
            expect(res).toMatchObject({ edited: false });
            const text = cardText(discord.postPayload.mock.calls[0][1]);
            expect(text).toContain("## Raids");
            // mixed languages (cat1 English, cat2 the server's German): the server's language
            expect(text).toContain("Diese ID");
            expect(text.indexOf("Molten Core")).toBeLessThan(text.indexOf("Karazhan"));
            expect(text).toContain("40er · <#ch-c>");
            expect(text).toContain("10er · <#ch-a>");
            expect(text).toContain("Late Raid");
            // a raid without a category belongs to no raid category
            expect(text).not.toContain("Loose Raid");
            expect(loadEventGroups).toHaveBeenCalledWith("g1");
            expect(store.getOverview("ms")).toMatchObject({ guildId: "g1", channelId: "c-ov", categoryId: "", scope: "server", lastChange: NOW_SEC });
        });

        it("leaves out a category switched off for the server overview, while its own overview still lists it", async () => {
            twoCategories();
            mockServerOverview = { cat2: false };
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            const text = cardText(discord.postPayload.mock.calls[0][1]);
            expect(text).toContain("Karazhan");
            expect(text).not.toContain("Molten Core");
            // only English raids left: the card speaks English
            expect(text).toContain("This ID");

            discord.postPayload.mockResolvedValue(posted("m2", "c2"));
            await overview.postOverview({ guildId: "g1", channelId: "c2", categoryId: "cat2", now: NOW });
            expect(cardText(discord.postPayload.mock.calls[1][1])).toContain("Molten Core");
        });

        it("speaks the language all its categories share", async () => {
            twoCategories();
            mockGroups[1].events = [];
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            const text = cardText(discord.postPayload.mock.calls[0][1]);
            expect(text).toContain("This ID");
            expect(text).toContain("## Raids");
        });

        it("takes its language only from the raids it lists, not from those cut off by its limits", async () => {
            // cat1 (English) fills the card; cat2 (the server's German) only has raids past the limits
            mockGroups = [
                { categoryId: "cat1", categoryName: "10er", events: Array.from({ length: 16 }, (_, i) => raid(`e${i}`, { startTime: NOW_SEC + DAY + i * 3600, categoryName: "10er" })) },
                { categoryId: "cat2", categoryName: "40er", events: [
                    raid("late4", { startTime: NOW_SEC + 30 * DAY, title: "Fourth ID Raid", categoryName: "40er" }),
                    raid("late1", { startTime: NOW_SEC + DAY + 20 * 3600, title: "Sixteenth Raid", categoryName: "40er" }),
                ] },
            ];
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            const text = cardText(discord.postPayload.mock.calls[0][1]);
            expect(text).not.toContain("Fourth ID Raid");
            expect(text).not.toContain("Sixteenth Raid");
            expect(text).toContain("This ID");
            expect(text).toMatch(/\+\d+ more raids/);
        });

        it("speaks the server's language once a listed raid comes from a category of another language", async () => {
            mockGroups = [
                { categoryId: "cat1", categoryName: "10er", events: [raid("a", { categoryName: "10er" })] },
                { categoryId: "cat2", categoryName: "40er", events: [raid("c", { startTime: NOW_SEC + 30 * DAY, categoryName: "40er" })] },
            ];
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("Diese ID");
        });

        it("falls back to the server's language when the shown raids' language would list other raids", async () => {
            // German lists only cat1 (English); English would let a cat2 (German) raid in: no stable answer
            const { shownRaids } = require("../../../../src/services/events/overview/raidOverviewPanel");
            const byLang = ({ events, lang }) => (lang === "de" ? events.filter((e) => e.title !== "Tight Fit") : events);
            shownRaids.mockImplementationOnce(byLang).mockImplementationOnce(byLang);
            mockGroups = [
                { categoryId: "cat1", categoryName: "10er", events: [raid("a", { categoryName: "10er" })] },
                { categoryId: "cat2", categoryName: "40er", events: [raid("c", { title: "Tight Fit", categoryName: "40er" })] },
            ];
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            expect(shownRaids.mock.calls.map((c) => c[0].lang)).toEqual(["de", "en"]);
            expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("Diese ID");
        });

        it("keeps the shown raids' language when it lists the same raids in it", async () => {
            const { shownRaids } = require("../../../../src/services/events/overview/raidOverviewPanel");
            mockGroups = [{ categoryId: "cat1", categoryName: "10er", events: [raid("a", { categoryName: "10er" })] }];
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            expect(shownRaids.mock.calls.map((c) => c[0].lang)).toEqual(["de", "en"]);
            expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("This ID");
        });

        it("speaks the server's language without any raid", async () => {
            mockGroups = [{ categoryId: "cat1", categoryName: "10er", events: [] }];
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("Gerade sind keine Raids geplant");
        });

        it("applies the filters of a category's overview and leaves out raids of another server", async () => {
            twoCategories();
            mockGroups[0].events.push(
                raid("h", { versionId: "hidden", title: "Hidden Raid" }),
                raid("x", { status: "cancelled", title: "Cancelled Raid" }),
                raid("p", { startTime: NOW_SEC - 3600, title: "Begun Raid" }),
                raid("s", { raidGroupId: "a", title: "Sibling Raid" }),
            );
            mockGroups[1].events.push(raid("o", { guildId: "g2", title: "Other Server Raid" }));
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            const text = cardText(discord.postPayload.mock.calls[0][1]);
            for (const gone of ["Hidden Raid", "Cancelled Raid", "Begun Raid", "Sibling Raid", "Other Server Raid"]) expect(text).not.toContain(gone);
            expect(text).toContain("Molten Core");
        });

        it("edits the server overview of the channel, never a category's overview there, and is never found as one", async () => {
            twoCategories();
            tracked({ channelId: "c-ov" });
            discord.postPayload.mockResolvedValue(posted("ms", "c-ov"));
            await serverPost();
            expect(discord.editPayload).not.toHaveBeenCalled();
            expect(store.listOverviews()).toHaveLength(2);
            discord.editPayload.mockResolvedValue({ url: "https://discord.com/channels/g1/c-ov/ms" });
            const again = await serverPost();
            expect(again.edited).toBe(true);
            expect(discord.editPayload).toHaveBeenCalledWith("c-ov", "ms", expect.any(Object));
            expect(discord.postPayload).toHaveBeenCalledTimes(1);
            expect(store.findInChannel("c-ov", "cat1").messageId).toBe("m1");
            expect(store.findServerInChannel("c-ov").messageId).toBe("ms");
        });

        it("needs its server and a channel", async () => {
            expect(await overview.postOverview({ channelId: "c-ov", scope: "server" })).toEqual({ error: "No server." });
            expect(await overview.postOverview({ guildId: "g1", scope: "server" })).toEqual({ error: "No channel." });
            mockGroupsError = "Raid-Helper down";
            expect(await serverPost()).toEqual({ error: "Raid-Helper down" });
            expect(store.listOverviews()).toEqual([]);
        });

        it("is redrawn by the sweep when its content changed and forgotten when deleted", async () => {
            twoCategories();
            tracked({ messageId: "ms", channelId: "c-ov", categoryId: "", scope: "server" });
            discord.editPayload.mockResolvedValue({});
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ edited: 1 });
            expect(cardText(discord.editPayload.mock.calls[0][2])).toContain("## Raids");
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ edited: 0, unchanged: 1 });
            mockGroups[1].events[0].signUps = [{ userId: "u1" }];
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ edited: 1 });
            discord.editPayload.mockRejectedValue(unknownMessage());
            mockGroups[1].events[0].signUps = [];
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ removed: 1 });
            expect(store.listOverviews()).toEqual([]);
            expect(discord.postPayload).not.toHaveBeenCalled();
        });

        it("logs a failed redraw under 'server'", async () => {
            tracked({ messageId: "ms", channelId: "c-ov", categoryId: "", scope: "server" });
            discord.editPayload.mockRejectedValue(new Error("Missing Access"));
            expect((await overview.refreshOverviews({ now: NOW })).failed).toBe(1);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("server/ms"));
        });

        it("leaves the category overviews byte for byte as they were", async () => {
            const before = await overview.currentContent("cat1", "g1", { now: NOW });
            twoCategories();
            mockGroups = [{ categoryId: "cat1", categoryName: "🔥 PUG Raids", events: [raid("a"), raid("b", { startTime: NOW_SEC + 9 * DAY })] }];
            const after = await overview.currentContent("cat1", "g1", { now: NOW });
            expect(after.hash).toBe(before.hash);
            expect(cardText(after.payload)).not.toContain("PUG Raids · ");
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

        it("never adopts a server overview as the overview of its channel's category", async () => {
            const c1 = channel("c1", [msg("srv", { interaction: { commandName: "createoverview" } })]);
            store.setOverview({ guildId: "g1", channelId: "c1", messageId: "srv", scope: "server", hash: "keep", lastChange: 5 });
            discord.getGuild.mockImplementation((id) => (id === "g1" ? guildWith([c1]) : undefined));
            const res = await overview.adoptExisting({ pauseMs: 0, wait });
            expect(res.adopted).toBe(0);
            expect(store.listOverviews()).toHaveLength(1);
            expect(store.getOverview("srv")).toMatchObject({ scope: "server", categoryId: "", hash: "keep" });
            expect(store.findInChannel("c1", "cat-c1")).toBeNull();
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

    describe("the week strip as a picture (a test)", () => {
        const { Resvg } = require("@resvg/resvg-js");
        const { clearImageCache } = require("../../../../src/services/discord/discordImage");
        const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

        beforeEach(() => {
            mockVisuals = { overviewWeekStrip: true };
            clearImageCache();
        });

        it("posts the picture as the message's file, referenced by its media gallery", async () => {
            discord.postPayload.mockResolvedValue(posted());
            await overview.postOverview({ guildId: "g1", channelId: "c1", categoryId: "cat1", now: NOW });
            const payload = discord.postPayload.mock.calls[0][1];
            expect(payload.images).toBeUndefined();
            expect(payload.attachments).toEqual([]);
            expect(payload.files.map((f) => f.name)).toEqual(["raid-id-1.png", "raid-id-2.png"]);
            expect(payload.files[0].attachment.subarray(0, 4).equals(PNG)).toBe(true);
            expect(JSON.stringify(payload.components)).toContain("attachment://raid-id-1.png");
        });

        it("replaces the old file on an edit, renders only when the content changed, drops the picture when switched off", async () => {
            tracked();
            discord.editPayload.mockResolvedValue({});
            Resvg.mockClear();
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ edited: 1 });
            const first = discord.editPayload.mock.calls[0][2];
            expect(first.attachments).toEqual([]);
            expect(first.files).toHaveLength(2);
            expect(Resvg).toHaveBeenCalledTimes(2);
            // nothing changed: no edit, no render
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ edited: 0, unchanged: 1 });
            expect(Resvg).toHaveBeenCalledTimes(2);
            // a full redraw of the same content takes the PNGs from the cache
            await overview.refreshOverviews({ now: NOW, onlyStale: false });
            expect(Resvg).toHaveBeenCalledTimes(2);
            expect(discord.editPayload.mock.calls[1][2].files[0].attachment).toBe(first.files[0].attachment);
            // switched off: the next sweep redraws the text form and removes the files
            mockVisuals = { overviewWeekStrip: false };
            expect(await overview.refreshOverviews({ now: NOW })).toMatchObject({ edited: 1 });
            const off = discord.editPayload.mock.calls[2][2];
            expect(off.files).toEqual([]);
            expect(off.attachments).toEqual([]);
            expect(JSON.stringify(off.components)).not.toContain("attachment://");
        });

        it("falls back to the text form when the picture cannot be rendered, and says so once", async () => {
            tracked();
            discord.editPayload.mockResolvedValue({});
            Resvg.mockImplementation(() => {
                throw new Error("no resvg binary");
            });
            try {
                await overview.refreshOverviews({ now: NOW, onlyStale: false });
                await overview.refreshOverviews({ now: NOW, onlyStale: false });
            } finally {
                Resvg.mockImplementation((svg, opts) => new (jest.requireActual("@resvg/resvg-js").Resvg)(svg, opts));
            }
            const payload = discord.editPayload.mock.calls[0][2];
            expect(payload.files).toEqual([]);
            expect(cardText(payload)).toContain("This ID");
            expect(logger.warn.mock.calls.filter(([m]) => /picture not rendered/.test(m))).toHaveLength(1);
        });
    });
});
