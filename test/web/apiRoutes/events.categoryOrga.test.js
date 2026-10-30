// Creating and managing events as the orga of their category (#728, epic #723), through the real router,
// the real gate (apiAccess + withUser `orgaScoped`), the real rule (services/roster/categoryOrga.js) and
// the real limits (web/events/eventCreateAccess.js): a manager of the roster of category cat1 creates
// events in cat1 only (in the version cat1 plays now, with cat1's channels), edits, moves, cancels,
// reopens and deletes cat1's raids, runs their sheet, softres and loot system and keeps cat1's series -
// never cat2's - without `raids` write. The global orga keeps every category and every value of the
// request; a raider role with `raids` write but no orga rank gets 403 orga_only, a raider nothing.
// The services behind the routes are mocked (their own tests); the events and signups are real stores.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => ""),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
// cat1's voice preset sits in a shared voice category, cat2's inside cat2
const mockConfig = { categoryVoiceChannel: { cat1: "v-shared", cat2: "v-cat2" }, serverSettings: { g1: { raidDefaults: { channelId: "c-gruul" } } } };
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settings/settingsStore"),
    getConfig: () => mockConfig,
    listRaidTemplates: () => [],
    getRaidTemplate: () => null,
    getRaidsheet: () => null,
}));
jest.mock("../../../src/stores/discord/channelArchiveStore", () => ({
    ...jest.requireActual("../../../src/stores/discord/channelArchiveStore"),
    getChannelConfig: () => ({ schemas: { cat1: { schema: "{date}-raid", templateChannelId: "t-schema" } } }),
}));
// Every category plays TBC now. cat1's TBC roster is managed by "mgr"; cat1 has a Forever roster
// prepared already (open, not current yet) managed by "fmgr". cat2 has no roster.
jest.mock("../../../src/stores/roster/rosterStore", () => {
    const roster = (id, categoryId, versionId, userIds) => ({ id, categoryId, versionId, guildId: "g1", managers: { userIds, roleIds: [] }, roleIds: [], members: {} });
    const rosters = {
        "cat1:tbc": roster("r1", "cat1", "tbc", ["mgr"]),
        "cat1:forever": roster("r1f", "cat1", "forever", ["fmgr"]),
    };
    return {
        listRosters: jest.fn(() => Object.values(rosters)),
        rosterForCategory: jest.fn((cat, version) => rosters[`${cat}:${version}`] || null),
        isClosed: jest.fn(() => false),
    };
});
jest.mock("../../../src/services/versions/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/versions/mainVersion"),
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
const mockMemberRoleIds = jest.fn(async () => []);
// The server: categories cat1, cat2 and a shared voice category; a text, a voice and a template channel each.
const mockChannels = [
    { id: "c-kara", parentId: "cat1", text: true }, { id: "c-gruul", parentId: "cat2", text: true },
    { id: "v-cat1", parentId: "cat1" }, { id: "v-cat2", parentId: "cat2" }, { id: "v-shared", parentId: "voice" },
    { id: "t-cat1", parentId: "cat1", text: true }, { id: "t-cat2", parentId: "cat2", text: true }, { id: "t-schema", parentId: "templates", text: true },
];
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
    resolveUserNames: jest.fn(async () => ({})),
    listGuilds: () => [{ id: "g1", name: "Pulse" }],
    listRoles: () => [],
    listCategories: () => [{ id: "cat1", name: "Kat 1" }, { id: "cat2", name: "Kat 2" }, { id: "voice", name: "Voice" }],
    listTextChannels: () => mockChannels.filter((c) => c.text).map((c) => ({ id: c.id, name: c.id, category: c.parentId, parentId: c.parentId })),
    listVoiceChannels: () => mockChannels.filter((c) => !c.text).map((c) => ({ id: c.id, name: c.id, category: c.parentId, parentId: c.parentId })),
    getChannelCategoryMap: () => Object.fromEntries(mockChannels.map((c) => [c.id, { name: c.id, categoryId: c.parentId, categoryName: c.parentId }])),
    postLink: jest.fn(async () => ({ channelId: "c", messageId: "m" })),
    // #925: the bot sees every category and channel above on the active server g1 (a new raid is placed by its category)
    getClient: () => ({ channels: { cache: new Map([...mockChannels.map((c) => c.id), "cat1", "cat2", "voice", "templates"].map((id) => [id, { id, guildId: "g1" }])) } }),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    ...jest.requireActual("../../../src/services/events/raidEventGroups"),
    loadEventGroups: jest.fn(async () => {
        const events = require("../../../src/stores/events/eventStore").listEvents("");
        const byCat = new Map();
        for (const e of events) {
            if (!byCat.has(e.categoryId)) byCat.set(e.categoryId, { categoryId: e.categoryId, events: [] });
            byCat.get(e.categoryId).events.push({ id: e.id, source: "eventhelper", channelId: e.channelId, title: e.title, startTime: e.startTime, categoryId: e.categoryId, versionId: e.versionId });
        }
        return { groups: [...byCat.values()], error: null };
    }),
}));
jest.mock("../../../src/services/events/eventManage", () => ({
    manageInfo: jest.fn(async () => ({ status: 200, body: {} })),
    movePlan: jest.fn(async () => ({ plan: {} })),
    moveEvent: jest.fn(async () => ({ status: 200, body: {} })),
    setSignupsOpen: jest.fn(async () => ({ status: 200, body: {} })),
    raiderCandidates: jest.fn(async () => ({ status: 200, body: {} })),
    addRaider: jest.fn(async () => ({ status: 200, body: {} })),
    removeRaider: jest.fn(async () => ({ status: 200, body: {} })),
    cancelEvent: jest.fn(async () => ({ status: 200, body: {} })),
    reopenEvent: jest.fn(async () => ({ status: 200, body: {} })),
    deleteEvent: jest.fn(async () => ({ status: 200, body: {} })),
    recreateChannel: jest.fn(async () => ({ status: 200, body: {} })),
}));
// createEvent / updateEvent are eventCreate.test.js'; here they stand for "the create went through" -
// createEvent still runs the caller's guard on the category the request asks for, as the real one does
jest.mock("../../../src/services/events/eventCreate", () => {
    const actual = jest.requireActual("../../../src/services/events/eventCreate");
    return {
        ...actual,
        createEvent: jest.fn(async ({ guildId, body, guard }) => {
            const categoryId = actual.requestedCategoryId(guildId, body);
            const plan = { versionId: body.versionId || "tbc", voiceChannelId: body.voiceChannelId || (categoryId === "cat1" ? "v-shared" : "") };
            const refused = guard ? await guard({ categoryId, plan, request: { newChannel: body.newChannel || null }, body }) : null;
            if (refused) return refused;
            return { status: 201, body: { id: "eh-new", categoryId } };
        }),
        updateEvent: jest.fn(async ({ body }) => ({ status: 200, body: { id: body.id } })),
    };
});
jest.mock("../../../src/stores/events/eventSeriesStore", () => ({
    ...jest.requireActual("../../../src/stores/events/eventSeriesStore"),
    deleteSeries: jest.fn(() => true),
    getRuns: jest.fn(() => ({})),
    clearRun: jest.fn(),
}));
jest.mock("../../../src/web/events/eventSeries", () => ({
    ...jest.requireActual("../../../src/web/events/eventSeries"),
    seriesOverview: jest.fn(async () => ({ categories: [{ id: "cat1" }, { id: "cat2" }], lastRun: null })),
    previewSeries: jest.fn(async () => ({ error: "", summary: "", upcoming: [] })),
    saveSeriesFor: jest.fn(() => ({ series: { categoryId: "cat1", enabled: true } })),
    runSeries: jest.fn(async () => ({ created: 0, failed: 0, existing: 0, ignored: 0, error: null, results: [] })),
}));
jest.mock("../../../src/stores/events/eventSoftresStore", () => ({
    getEventSoftres: jest.fn(() => ({ url: "https://softres.it/raid/abc" })),
    saveEventSoftres: jest.fn(),
    setEventSoftresLink: jest.fn(),
    markEventSoftresPosted: jest.fn(),
}));
jest.mock("../../../src/stores/events/eventSheetStore", () => ({
    getEventSheet: jest.fn(() => null),
    markEventSheetFilled: jest.fn(),
    markEventSheetPosted: jest.fn(),
}));
jest.mock("../../../src/stores/events/eventLootSystemStore", () => ({
    setEventLootSystem: jest.fn(),
    lootSystemOf: jest.fn(() => ({ label: "Softres", softresExtra: false })),
}));
jest.mock("../../../src/utils/loot/wowhead", () => ({ searchItems: jest.fn(async () => []) }));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventStore = require("../../../src/stores/events/eventStore");
const signupStore = require("../../../src/stores/events/signupStore");
const seriesStore = require("../../../src/stores/events/eventSeriesStore");
const { emptyAccess } = require("../../../src/config/permissions");
const manage = require("../../../src/services/events/eventManage");
const eventCreate = require("../../../src/services/events/eventCreate");
const seriesService = require("../../../src/web/events/eventSeries");
const softresStore = require("../../../src/stores/events/eventSoftresStore");
const sheetStore = require("../../../src/stores/events/eventSheetStore");
const lootSystemStore = require("../../../src/stores/events/eventLootSystemStore");
const wowhead = require("../../../src/utils/loot/wowhead");
const discord = require("../../../src/services/discord/discord");
const raidsRoutes = require("../../../src/web/apiRoutes/events/raids");
const manageRoutes = require("../../../src/web/apiRoutes/events/eventManage");
const detailRoutes = require("../../../src/web/apiRoutes/events/raidDetail");
const seriesRoutes = require("../../../src/web/apiRoutes/events/eventSeries");
const { routerClient, status, body } = require("../../helpers/http");

const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const clients = [raidsRoutes, manageRoutes, detailRoutes, seriesRoutes].map((m) => [new Set(m.routes.map((r) => r.path)), routerClient(m)]);
const clientFor = (path) => clients.find(([paths]) => paths.has(path))[1];
const send = (method, path, payload) => (method === "GET" ? clientFor(path).get(path, payload) : clientFor(path).request(method, path, payload));
const code = (r) => (body(r).error || {}).code;

const raiderAccess = () => ({ ...emptyAccess(), raids: { read: true, write: false }, signup: { read: true, write: true } });
const MANAGER = { id: "mgr", name: "Manager", isAdmin: false, access: raiderAccess() };
const RAIDER = { id: "raider", name: "Raider", isAdmin: false, access: raiderAccess() };
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true } } };
const WRITER = { id: "rw", name: "Schreiber", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: true } } };

let own;
let foreign;

function raid(categoryId, title, channelId, versionId = "tbc") {
    const event = eventStore.createEvent({
        guildId: "g1", channelId, categoryId, title, startTime: START, versionId,
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
    signupStore.saveSignup(event.id, "h1", { character: "H1", spec: "Priest-Holy", status: "signed" }, { versionId });
    return event;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockMemberRoleIds.mockResolvedValue([]);
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    own = raid("cat1", "Karazhan", "c-kara");
    foreign = raid("cat2", "Gruul", "c-gruul");
});

const newIn = (categoryId, extra = {}) => ({ title: "Raid", date: "2026-12-01", time: "20:00", signupSource: "eventhelper", newChannel: { name: "", categoryId }, ...extra });

// one call per route this part opens to the orga of a category, naming the raid (or category) given
const callsFor = (event, categoryId) => ({
    "POST /api/raids": newIn(categoryId),
    "PATCH /api/raids": { id: event, title: "Neu" },
    "GET /api/raids/manage": { event },
    "GET /api/raids/manage/move": { event, date: "2026-12-01", time: "20:00" },
    "POST /api/raids/manage/move": { event, date: "2026-12-01", time: "20:00" },
    "POST /api/raids/manage/cancel": { event, reason: "Zu wenige" },
    "POST /api/raids/manage/reopen": { event },
    "POST /api/raids/manage/delete": { event },
    "POST /api/raids/manage/recreate-channel": { event },
    "POST /api/raids/fill": { event, sheetId: "s1" },
    "POST /api/raids/post-sheet": { event },
    "POST /api/raids/post-softres": { event },
    "GET /api/raids/softres/item-search": { event, q: "Schwert", edition: "tbc" },
    "POST /api/raids/softres": { event, instanceCodes: [] },
    "POST /api/raids/softres/link": { event, softresUrl: "https://softres.it/raid/xyz" },
    "POST /api/raids/loot-system": { event, system: "" },
    "GET /api/raids/series/preview": { category: categoryId, weekdays: "3", time: "20:00" },
    "PUT /api/raids/series": { categoryId, weekdays: [3], time: "20:00" },
    "DELETE /api/raids/series": { categoryId },
    "POST /api/raids/series/run": { categoryId },
});

// the other parts' orgaScoped routes in these files (#726, #727 - their own tests)
const OTHER_PARTS = new Set([
    "POST /api/raids/manage/signups", "GET /api/raids/manage/raider", "POST /api/raids/manage/raider", "POST /api/raids/manage/raider/remove",
    "POST /api/raids/notify", "POST /api/raids/ping-missing", "POST /api/raids/invite-call", "POST /api/raids/post-raidplan",
]);

describe("the orga of a category (a manager of its roster)", () => {
    beforeEach(() => { mockUser = MANAGER; });

    it("passes the gate on every route of this part for a raid of their category, without `raids` write", async () => {
        for (const [key, payload] of Object.entries(callsFor(own.id, "cat1"))) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            // a handler's own refusal (no sheet, no instances) is fine here - only the gate's 403 is not
            expect([key, status(r) === 403 ? code(r) : "passed"]).toEqual([key, "passed"]);
        }
        expect(manage.moveEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id, user: MANAGER }));
        expect(manage.cancelEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id }));
        expect(manage.reopenEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id }));
        expect(manage.deleteEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id }));
        expect(manage.recreateChannel).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id }));
        expect(manage.manageInfo).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id }));
        expect(softresStore.setEventSoftresLink).toHaveBeenCalledWith(own.id, expect.anything());
        expect(lootSystemStore.setEventLootSystem).toHaveBeenCalledWith(own.id, expect.anything());
        expect(wowhead.searchItems).toHaveBeenCalled();
        expect(discord.postLink).toHaveBeenCalled();
        expect(eventCreate.updateEvent).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ id: own.id }) }));
        expect(seriesService.saveSeriesFor).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ categoryId: "cat1" }) }));
        expect(seriesStore.deleteSeries).toHaveBeenCalledWith("cat1");
        expect(seriesService.runSeries).toHaveBeenCalledWith({ onlyCategoryId: "cat1" });
    });

    it("gets 403 not_category_orga on every route of this part for another category, and nothing changes", async () => {
        const before = JSON.parse(JSON.stringify(eventStore.getEvent(foreign.id)));
        const signupsBefore = JSON.parse(JSON.stringify(signupStore.listSignups(foreign.id)));
        const eventsBefore = eventStore.listEvents("").map((e) => e.id).sort();
        const calls = callsFor(foreign.id, "cat2");
        const scoped = [raidsRoutes, manageRoutes, detailRoutes, seriesRoutes].flatMap((m) => m.routes)
            .filter((r) => r.handler.orgaScoped).map((r) => `${r.method} ${r.path}`).filter((key) => !OTHER_PARTS.has(key));
        expect(Object.keys(calls).sort()).toEqual([...scoped].sort());
        for (const [key, payload] of Object.entries(calls)) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            expect([key, status(r), code(r)]).toEqual([key, 403, "not_category_orga"]);
        }
        expect(eventStore.getEvent(foreign.id)).toEqual(before);
        expect(signupStore.listSignups(foreign.id)).toEqual(signupsBefore);
        expect(eventStore.listEvents("").map((e) => e.id).sort()).toEqual(eventsBefore);
        for (const fn of [
            manage.manageInfo, manage.movePlan, manage.moveEvent, manage.cancelEvent, manage.reopenEvent, manage.deleteEvent, manage.recreateChannel,
            eventCreate.createEvent, eventCreate.updateEvent, seriesService.previewSeries, seriesService.saveSeriesFor, seriesService.runSeries, seriesStore.deleteSeries,
            softresStore.saveEventSoftres, softresStore.setEventSoftresLink, softresStore.markEventSoftresPosted,
            sheetStore.markEventSheetFilled, sheetStore.markEventSheetPosted, lootSystemStore.setEventLootSystem, wowhead.searchItems, discord.postLink,
        ]) {
            expect(fn).not.toHaveBeenCalled();
        }
    });

    it("names no raid or category: refused (the item search, a sweep of every series)", async () => {
        expect(code(await send("GET", "/api/raids/softres/item-search", { q: "Schwert", edition: "tbc" }))).toBe("not_category_orga");
        expect(code(await send("POST", "/api/raids/series/run", {}))).toBe("not_category_orga");
        expect(code(await send("POST", "/api/raids", { title: "Raid", date: "2026-12-01", time: "20:00" }))).toBe("not_category_orga");
        expect(seriesService.runSeries).not.toHaveBeenCalled();
        expect(eventCreate.createEvent).not.toHaveBeenCalled();
    });

    describe("creating an event", () => {
        it("creates in their category, the version left to the server", async () => {
            const r = await send("POST", "/api/raids", newIn("cat1"));
            expect(status(r)).toBe(201);
            const call = eventCreate.createEvent.mock.calls[0][0];
            expect(typeof call.guard).toBe("function");
        });

        it("takes the category from the chosen channel or the cloned raid, not from the request", async () => {
            // an existing channel of cat2, a clone of cat2's raid - whatever else the body says
            for (const payload of [
                { title: "Raid", date: "2026-12-01", time: "20:00", channelId: "c-gruul", newChannel: { name: "", categoryId: "cat1" } },
                { title: "Raid", date: "2026-12-01", time: "20:00", sourceEventId: foreign.id, newChannel: { name: "", categoryId: "cat1" } },
            ]) {
                expect(code(await send("POST", "/api/raids", payload))).toBe("not_category_orga");
            }
            expect(eventCreate.createEvent).not.toHaveBeenCalled();
            // the own channel and the own raid are fine
            expect(status(await send("POST", "/api/raids", { title: "Raid", date: "2026-12-01", time: "20:00", channelId: "c-kara" }))).toBe(201);
            expect(status(await send("POST", "/api/raids", { title: "Raid", date: "2026-12-01", time: "20:00", sourceEventId: own.id }))).toBe(201);
        });

        it("never counts a versionId of the request: another version than the category plays is refused", async () => {
            const r = await send("POST", "/api/raids", newIn("cat1", { versionId: "forever" }));
            expect([status(r), code(r)]).toEqual([409, "version_fixed"]);
            expect(status(await send("POST", "/api/raids", newIn("cat1", { versionId: "tbc" })))).toBe(201);
        });

        it("refuses a voice or template channel of another category, takes the category's own", async () => {
            for (const extra of [{ voiceChannelId: "v-cat2" }, { newChannel: { name: "", categoryId: "cat1", templateChannelId: "t-cat2" } }]) {
                const r = await send("POST", "/api/raids", newIn("cat1", extra));
                expect([extra, status(r), code(r)]).toEqual([extra, 400, "channel_not_allowed"]);
            }
            for (const extra of [
                { voiceChannelId: "v-cat1" }, { voiceChannelId: "v-shared" }, { voiceChannelId: "" },
                { newChannel: { name: "", categoryId: "cat1", templateChannelId: "t-cat1" } },
                { newChannel: { name: "", categoryId: "cat1", templateChannelId: "t-schema" } },
            ]) {
                expect([extra, status(await send("POST", "/api/raids", newIn("cat1", extra)))]).toEqual([extra, 201]);
            }
        });

        it("offers only their categories, channels and raids in the create dialog", async () => {
            const ctx = body(await send("GET", "/api/raids/new", {}));
            expect(ctx.categories.map((c) => c.id)).toEqual(["cat1"]);
            expect(ctx.channels.map((c) => c.id).sort()).toEqual(["c-kara", "t-cat1"]);
            expect(ctx.voiceChannels.map((c) => c.id).sort()).toEqual(["v-cat1", "v-shared"]);
            expect(ctx.categoryVoiceChannel).toEqual({ cat1: "v-shared" });
            expect(ctx.reusableEvents.map((e) => e.id)).toEqual([own.id]);
            // the default channel is cat2's: not offered
            expect(ctx.defaults.channelId).toBe("");
            // "Als Vorlage speichern" writes a global raid template
            expect(ctx.canSaveTemplate).toBe(false);
            expect(body(await send("GET", "/api/raids/new", { event: foreign.id })).editEvent).toBeNull();
            expect(body(await send("GET", "/api/raids/new", { event: own.id })).editEvent.id).toBe(own.id);
        });
    });

    describe("editing their raid (PATCH /api/raids)", () => {
        it("keeps its version: another one is refused, the same one passes", async () => {
            const r = await send("PATCH", "/api/raids", { id: own.id, versionId: "forever" });
            expect([status(r), code(r)]).toEqual([409, "version_fixed"]);
            expect(eventCreate.updateEvent).not.toHaveBeenCalled();
            expect(status(await send("PATCH", "/api/raids", { id: own.id, versionId: "tbc", size: 25 }))).toBe(200);
        });

        it("takes a voice channel of the raid's category only", async () => {
            const r = await send("PATCH", "/api/raids", { id: own.id, voiceChannelId: "v-cat2" });
            expect([status(r), code(r)]).toEqual([400, "channel_not_allowed"]);
            expect(status(await send("PATCH", "/api/raids", { id: own.id, voiceChannelId: "v-cat1" }))).toBe(200);
        });
    });

    it("sees and writes only the series of their categories", async () => {
        const r = body(await send("GET", "/api/raids/series", {}));
        expect(r.categories.map((c) => c.id)).toEqual(["cat1"]);
        expect(r.canWrite).toBe(true);
        // "Jetzt prüfen" sweeps every series (run without categoryId): not offered, the gate refuses it
        expect(r.canRunAll).toBe(false);
    });
});

describe("the manager of a roster prepared for a coming version (open, not current yet)", () => {
    it("is no orga of the category yet: no create, no series, no raid of that version", async () => {
        mockUser = { ...MANAGER, id: "fmgr" };
        const forever = raid("cat1", "Forever-Raid", "c-fe", "forever");
        expect(status(await send("POST", "/api/raids", newIn("cat1")))).toBe(403);
        expect(status(await send("PUT", "/api/raids/series", { categoryId: "cat1" }))).toBe(403);
        expect(status(await send("POST", "/api/raids/manage/cancel", { event: forever.id }))).toBe(403);
        expect(body(await send("GET", "/api/raids/new", {})).categories).toEqual([]);
        expect(body(await send("GET", "/api/raids/series", {})).categories).toEqual([]);
        expect(eventCreate.createEvent).not.toHaveBeenCalled();
        expect(manage.cancelEvent).not.toHaveBeenCalled();
    });
});

describe("the global orga and everybody else", () => {
    it("lets the global orga do everything as before, in every category, with the request's values", async () => {
        mockUser = ORGA;
        for (const [event, cat] of [[own.id, "cat1"], [foreign.id, "cat2"]]) {
            for (const [key, payload] of Object.entries(callsFor(event, cat))) {
                const [method, path] = key.split(" ");
                const r = await send(method, path, payload);
                expect([key, status(r) === 403 ? code(r) : "passed"]).toEqual([key, "passed"]);
            }
        }
        // no limits: another version, any voice channel, no guard at all
        expect(status(await send("POST", "/api/raids", newIn("cat2", { versionId: "forever", voiceChannelId: "v-cat1" })))).toBe(201);
        expect(eventCreate.createEvent.mock.calls.every(([c]) => c.guard === null)).toBe(true);
        expect(status(await send("PATCH", "/api/raids", { id: foreign.id, versionId: "forever" }))).toBe(200);
        // a sweep of every series at once and the item search without a raid
        expect(status(await send("POST", "/api/raids/series/run", {}))).toBe(200);
        expect(status(await send("GET", "/api/raids/softres/item-search", { q: "x", edition: "tbc" }))).toBe(200);
        const ctx = body(await send("GET", "/api/raids/new", {}));
        expect(ctx.categories.map((c) => c.id)).toEqual(["cat1", "cat2", "voice"]);
        expect(ctx.canSaveTemplate).toBe(true);
        const seriesView = body(await send("GET", "/api/raids/series", {}));
        expect(seriesView.categories.map((c) => c.id)).toEqual(["cat1", "cat2"]);
        expect([seriesView.canWrite, seriesView.canRunAll]).toEqual([true, true]);
        // no roster was asked for the global orga
        expect(mockMemberRoleIds).not.toHaveBeenCalled();
    });

    it("refuses a raider role with `raids` write but no orga rank with orga_only", async () => {
        mockUser = WRITER;
        for (const [key, payload] of Object.entries(callsFor(own.id, "cat1"))) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            expect([key, status(r), code(r)]).toEqual([key, 403, "orga_only"]);
        }
        expect(eventCreate.createEvent).not.toHaveBeenCalled();
        expect(body(await send("GET", "/api/raids/new", {})).categories).toEqual([]);
        expect(body(await send("GET", "/api/raids/series", {})).categories).toEqual([]);
    });

    it("refuses a raider who manages no roster", async () => {
        mockUser = RAIDER;
        for (const [key, payload] of Object.entries(callsFor(own.id, "cat1"))) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            // a write stops at the area gate; a read passes it (`raids` read) and stops at the orga
            expect([key, status(r), code(r)]).toEqual([key, 403, method === "GET" ? "orga_only" : "forbidden"]);
        }
        const ctx = body(await send("GET", "/api/raids/new", {}));
        expect([ctx.categories, ctx.channels, ctx.voiceChannels, ctx.reusableEvents]).toEqual([[], [], [], []]);
        expect(eventCreate.createEvent).not.toHaveBeenCalled();
        expect(manage.deleteEvent).not.toHaveBeenCalled();
    });
});
