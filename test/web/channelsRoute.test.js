// The Kanäle API handlers (issue #259), called directly with Discord mocked.
jest.mock("../../src/web/apiMiddleware", () => ({
    requireAdmin: jest.fn(),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn() }));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    getRaidTemplate: jest.fn((id) => (id === "tpl-kara" ? { id: "tpl-kara", name: "Karazhan 10er" } : null)),
    listRecruitmentPosts: jest.fn(() => []),
}));
jest.mock("../../src/web/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../src/web/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
jest.mock("../../src/web/raidEventGroups", () => ({ fetchEventsCached: jest.fn(async () => ({ events: [] })) }));
jest.mock("../../src/web/channelOps", () => {
    const actual = jest.requireActual("../../src/web/channelOps");
    return { ...actual, runSerial: (ids, fn) => actual.runSerial(ids, fn, { pauseMs: 0 }) };
});
jest.mock("../../src/web/channelArchiveStore", () => {
    const actual = jest.requireActual("../../src/web/channelArchiveStore");
    return {
        ...actual,
        getChannelConfig: jest.fn(() => ({ archiveCategoryId: "arch", schemas: {}, archiveDeleteHintDays: 14 })),
        saveChannelConfig: jest.fn((guildId, partial) => partial),
        saveCategorySchema: jest.fn(),
        recordArchived: jest.fn(),
        listArchived: jest.fn(() => []),
        forgetArchived: jest.fn(),
    };
});
jest.mock("../../src/web/discord", () => ({
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    listGuilds: jest.fn(() => []),
}));
jest.mock("../../src/web/discordChannels", () => {
    const actual = jest.requireActual("../../src/web/discordChannels");
    return {
        ...actual,
        listChannelDetails: jest.fn(() => ({})),
        botCanManageChannels: jest.fn(() => true),
        editChannel: jest.fn(),
        archiveChannel: jest.fn(),
        deleteChannel: jest.fn(),
        createCategory: jest.fn(),
        createFromTemplate: jest.fn(async (guildId, { name }) => ({ id: `new-${name}`, name })),
    };
});

const { requireAdmin } = require("../../src/web/apiMiddleware");
const { readJsonBody } = require("../../src/web/apiBody");
const discord = require("../../src/web/discord");
const dc = require("../../src/web/discordChannels");
const archiveStore = require("../../src/web/channelArchiveStore");
const { listRaidEvents } = require("../../src/web/raidEventStore");
const routes = require("../../src/web/apiRoutes/channels");

const ADMIN = { id: "u1", name: "Nerathil", isAdmin: true };
const CHANNELS = [
    { id: "c1", name: "mi-17-09-ssc", type: 0, parentId: "cat1" },
    { id: "c2", name: "do-18-09-bt", type: 0, parentId: "cat1" },
    { id: "a1", name: "alt", type: 0, parentId: "arch" },
];

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
const status = (res) => res.writeHead.mock.calls[0][0];
const body = (res) => JSON.parse(res.end.mock.calls[0][0]);

beforeEach(() => {
    jest.clearAllMocks();
    requireAdmin.mockReturnValue(ADMIN);
    discord.listAllChannels.mockReturnValue(CHANNELS);
    discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }, { id: "arch", name: "Archiv" }]);
    discord.listGuilds.mockReturnValue([{ id: "g1", name: "Pulse" }]);
});

describe("GET /api/channels", () => {
    it("adds events, the archive hint and the schemas to the channel list", async () => {
        const now = Date.now() / 1000;
        listRaidEvents.mockReturnValue([{ id: "e1", channelId: "c1", title: "SSC", startTime: now - 7 * 86400 }]);
        archiveStore.listArchived.mockReturnValue([{ channelId: "a1", at: Date.now() - 20 * 86400000, byName: "Nerathil" }, { channelId: "gone", at: 0 }]);
        const res = mockRes();
        await routes.getChannels({}, res);
        const data = body(res).data;
        expect(data.events.c1).toMatchObject({ status: "past", title: "SSC" });
        expect(data.archive).toMatchObject({ categoryId: "arch", count: 1, overdue: 1, hintDays: 14 });
        expect(data.defaultSchema).toBe("{tag}-{dd}-{mm}-{raid}");
        // the log forgets a channel that no longer exists in Discord
        expect(archiveStore.forgetArchived).toHaveBeenCalledWith(["gone"]);
    });
});

describe("PATCH /api/channels", () => {
    it("applies only the changed fields and reports per channel", async () => {
        dc.editChannel.mockImplementation(async (id) => {
            if (id === "c2") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
            return { id, name: "x" };
        });
        readJsonBody.mockResolvedValue({ ids: ["c1", "c2", "elsewhere"], changes: { topic: "Flasks Pflicht" } });
        const res = mockRes();
        await routes.patchChannels({}, res);
        expect(dc.editChannel).toHaveBeenCalledTimes(2);
        expect(dc.editChannel).toHaveBeenCalledWith("c1", { topic: "Flasks Pflicht" });
        const data = body(res).data;
        expect(data.results.map((r) => [r.id, r.ok, r.error])).toEqual([
            ["c1", true, undefined], ["c2", false, "fehlende Rechte"], ["elsewhere", false, "Kanal nicht auf diesem Server"],
        ]);
        expect(data.message).toBe("1 Kanal geändert, 2 fehlgeschlagen: fehlende Rechte, Kanal nicht auf diesem Server");
    });

    it("refuses invalid changes before touching Discord", async () => {
        readJsonBody.mockResolvedValue({ ids: ["c1"], changes: { rateLimitPerUser: -1 } });
        const res = mockRes();
        await routes.patchChannels({}, res);
        expect(status(res)).toBe(400);
        expect(dc.editChannel).not.toHaveBeenCalled();
    });
});

describe("POST /api/channels/archive", () => {
    it("archives and logs who did it", async () => {
        dc.archiveChannel.mockResolvedValue({ id: "c1", name: "mi-17-09-ssc", fromParentId: "cat1", fromCategory: "Raids", guildId: "g1" });
        readJsonBody.mockResolvedValue({ ids: ["c1"] });
        const res = mockRes();
        await routes.archiveChannels({}, res);
        expect(dc.archiveChannel).toHaveBeenCalledWith("c1", "arch");
        expect(archiveStore.recordArchived).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", guildId: "g1", by: "u1", byName: "Nerathil", fromCategory: "Raids" }));
        expect(body(res).data.message).toBe("1 Kanal archiviert");
    });

    it("needs an archive category first", async () => {
        archiveStore.getChannelConfig.mockReturnValueOnce({ archiveCategoryId: "", schemas: {}, archiveDeleteHintDays: 14 });
        const res = mockRes();
        await routes.archiveChannels({}, res);
        expect(body(res).error.code).toBe("no_archive");
    });
});

describe("POST /api/channels/delete", () => {
    it("wants the channel's name typed for one channel", async () => {
        readJsonBody.mockResolvedValue({ ids: ["a1"], confirm: "falsch" });
        const res = mockRes();
        await routes.deleteChannels({}, res);
        expect(body(res).error.code).toBe("not_confirmed");
        expect(dc.deleteChannel).not.toHaveBeenCalled();
    });

    it("deletes from the archive and passes the refusal for anything outside it through per channel", async () => {
        dc.deleteChannel.mockImplementation(async (id, archiveId) => {
            const channel = CHANNELS.find((c) => c.id === id);
            if (channel.parentId !== archiveId) throw new Error("Nur Kanäle im Archiv können gelöscht werden.");
            return { id, name: channel.name };
        });
        readJsonBody.mockResolvedValue({ ids: ["a1", "c1"], confirm: routes.BULK_DELETE_WORD });
        const res = mockRes();
        await routes.deleteChannels({}, res);
        const data = body(res).data;
        expect(data.results.map((r) => [r.id, r.ok])).toEqual([["a1", true], ["c1", false]]);
        expect(data.results[1].error).toContain("Nur Kanäle im Archiv");
        expect(archiveStore.forgetArchived).toHaveBeenCalledWith(["a1"]);
    });
});

describe("POST /api/channels/batch", () => {
    it("previews without creating and marks existing names", async () => {
        discord.listAllChannels.mockReturnValue([...CHANNELS, { id: "x", name: "mi-23-09-ssc", type: 0, parentId: "cat1" }]);
        readJsonBody.mockResolvedValue({ categoryId: "cat1", schema: "{tag}-{dd}-{mm}-{raid}", raid: "ssc", from: "2026-09-23", count: 2, interval: "weekly", dryRun: true });
        const res = mockRes();
        await routes.batchCreate({}, res);
        expect(body(res).data.plan).toEqual([
            { date: "2026-09-23", name: "mi-23-09-ssc", exists: true },
            { date: "2026-09-30", name: "mi-30-09-ssc", exists: false },
        ]);
        expect(dc.createFromTemplate).not.toHaveBeenCalled();
    });

    it("creates only the missing ones and remembers the schema", async () => {
        discord.listAllChannels.mockReturnValue([...CHANNELS, { id: "x", name: "mi-23-09-ssc", type: 0, parentId: "cat1" }]);
        readJsonBody.mockResolvedValue({ categoryId: "cat1", schema: "{tag}-{dd}-{mm}-{raid}", raid: "ssc", from: "2026-09-23", count: 2, interval: "weekly", templateChannelId: "c1", saveSchema: true });
        const res = mockRes();
        await routes.batchCreate({}, res);
        expect(dc.createFromTemplate).toHaveBeenCalledTimes(1);
        expect(dc.createFromTemplate).toHaveBeenCalledWith("g1", { name: "mi-30-09-ssc", parentId: "cat1", templateChannelId: "c1" });
        expect(archiveStore.saveCategorySchema).toHaveBeenCalledWith("g1", "cat1", { schema: "{tag}-{dd}-{mm}-{raid}", raid: "ssc", templateChannelId: "c1" });
        expect(body(res).data.message).toBe("1 Kanal angelegt, 1 übersprungen (existiert)");
    });

    describe("gleich Event anlegen", () => {
        const { getConfig } = require("../../src/web/settingsStore");
        const eventCreate = require("../../src/web/eventCreate");
        const input = { categoryId: "cat1", schema: "{tag}-{dd}-{mm}-{raid}", raid: "kara", from: "2026-09-23", count: 3, interval: "weekly", withEvent: true, time: "1930", saveSchema: true };

        beforeEach(() => {
            getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "tpl-kara" }, categorySignupSource: { cat1: "eventhelper" } });
            discord.listAllChannels.mockReturnValue([...CHANNELS, { id: "x", name: "mi-30-09-kara", type: 0, parentId: "cat1" }]);
        });
        afterEach(() => getConfig.mockReturnValue({}));

        it("creates an event per new channel with the category's template, source, the series' date and the time", async () => {
            eventCreate.createEvent
                .mockResolvedValueOnce({ status: 201, body: { id: "eh-1", source: "eventhelper", messageError: null } })
                .mockResolvedValueOnce({ error: { status: 400, code: "invalid_plan", message: "Mehr Tanks und Heiler als Plätze." } });
            readJsonBody.mockResolvedValue(input);
            const res = mockRes();
            await routes.batchCreate({}, res);
            expect(status(res)).toBe(201);
            expect(eventCreate.createEvent).toHaveBeenCalledTimes(2);
            expect(eventCreate.createEvent.mock.calls[0][0]).toEqual({
                guildId: "g1",
                user: ADMIN,
                body: { title: "Karazhan 10er", date: "2026-09-23", time: "19:30", channelId: "new-mi-23-09-kara", signupSource: "eventhelper", raidTemplateId: "tpl-kara" },
            });
            expect(eventCreate.createEvent.mock.calls[1][0].body.date).toBe("2026-10-07");
            expect(archiveStore.saveCategorySchema).toHaveBeenCalledWith("g1", "cat1", { schema: input.schema, raid: "kara", templateChannelId: "", time: "19:30" });
            const data = body(res).data;
            expect(data.results.map((r) => [r.name, r.ok, r.eventId, r.eventError])).toEqual([
                ["mi-23-09-kara", true, "eh-1", undefined],
                ["mi-07-10-kara", true, undefined, "Mehr Tanks und Heiler als Plätze."],
            ]);
            expect(data.failed).toBe(1);
            expect(data.message).toBe("2 Kanäle angelegt · 1 Event angelegt · 1 übersprungen (existiert)\nmi-07-10-kara: Event fehlgeschlagen – Mehr Tanks und Heiler als Plätze.");
        });

        it("names the event after the category without a template and uses Raid-Helper as its source", async () => {
            getConfig.mockReturnValue({});
            eventCreate.createEvent.mockResolvedValue({ status: 201, body: { id: "9001" } });
            readJsonBody.mockResolvedValue({ ...input, count: 1 });
            const res = mockRes();
            await routes.batchCreate({}, res);
            expect(eventCreate.createEvent.mock.calls[0][0].body).toEqual({ title: "Raids", date: "2026-09-23", time: "19:30", channelId: "new-mi-23-09-kara", signupSource: "raidhelper" });
            expect(body(res).data).toMatchObject({ failed: 0, message: "1 Kanal angelegt · 1 Event angelegt" });
        });

        it("needs raids write, a category and a valid time — before anything is created", async () => {
            requireAdmin.mockReturnValue({ id: "u2", isAdmin: false, access: { channels: { read: true, write: true } } });
            readJsonBody.mockResolvedValue(input);
            let res = mockRes();
            await routes.batchCreate({}, res);
            expect(status(res)).toBe(403);

            requireAdmin.mockReturnValue(ADMIN);
            readJsonBody.mockResolvedValue({ ...input, categoryId: "" });
            res = mockRes();
            await routes.batchCreate({}, res);
            expect(body(res).error.code).toBe("no_category");

            readJsonBody.mockResolvedValue({ ...input, time: "25:00" });
            res = mockRes();
            await routes.batchCreate({}, res);
            expect(body(res).error.code).toBe("invalid_time");
            expect(dc.createFromTemplate).not.toHaveBeenCalled();
            expect(eventCreate.createEvent).not.toHaveBeenCalled();
        });

        it("offers the switch with the category defaults in GET /api/channels", async () => {
            const res = mockRes();
            await routes.getChannels({}, res);
            const data = body(res).data;
            expect(data.canCreateEvents).toBe(true);
            expect(data.eventDefaults.cat1).toEqual({ templateId: "tpl-kara", templateName: "Karazhan 10er", source: "eventhelper" });
            expect(data.eventDefaults.arch).toEqual({ templateId: "", templateName: "", source: "raidhelper" });
        });
    });

    it("refuses a date that does not exist", async () => {
        readJsonBody.mockResolvedValue({ from: "2026-02-30", dryRun: true });
        const res = mockRes();
        await routes.batchCreate({}, res);
        expect(body(res).error.code).toBe("invalid_date");
    });
});

describe("POST /api/channels/rename-preview", () => {
    it("fills the schema per channel from its event and flags collisions", async () => {
        listRaidEvents.mockReturnValue([{ id: "e1", channelId: "c1", startTime: Date.UTC(2026, 8, 16, 18) / 1000 }]);
        readJsonBody.mockResolvedValue({ ids: ["c1", "c2"], schema: "{tag}-{dd}-{mm}-{raid}", raid: "ssc" });
        const res = mockRes();
        await routes.renamePreview({}, res);
        expect(body(res).data.rows).toEqual([
            { id: "c1", from: "mi-17-09-ssc", to: "mi-16-09-ssc", hasDate: true, conflict: false },
            { id: "c2", from: "do-18-09-bt", to: "ssc", hasDate: false, conflict: false },
        ]);
    });
});

describe("POST /api/channels/config", () => {
    it("creates the archive category on request", async () => {
        dc.createCategory.mockResolvedValue({ id: "newarch", name: "Archiv" });
        readJsonBody.mockResolvedValue({ createArchiveCategory: "Archiv", archiveDeleteHintDays: 10 });
        const res = mockRes();
        await routes.saveConfig({}, res);
        expect(archiveStore.saveChannelConfig).toHaveBeenCalledWith("g1", { archiveCategoryId: "newarch", archiveDeleteHintDays: 10 });
    });

    it("refuses a category of another server", async () => {
        readJsonBody.mockResolvedValue({ archiveCategoryId: "fremd" });
        const res = mockRes();
        await routes.saveConfig({}, res);
        expect(body(res).error.code).toBe("unknown_category");
    });
});
