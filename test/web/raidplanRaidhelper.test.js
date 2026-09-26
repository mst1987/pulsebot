// The raid plan of a Raid-Helper event (docs/raidplan.md, "Raid-Helper-Events"): the switch (POST /api/raidplan/link), the players read
// from Raid-Helper (raidplanRosterSource.js - read only, mocked here), the fallbacks and the protection against losing players.
let mockUser = null;
let mockViewer = null;
jest.mock("../../src/web/apiMiddleware", () => require("../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../src/web/apiBody", () => require("../helpers/http").apiBodyMock());
jest.mock("../../src/web/auth", () => ({ getUser: jest.fn(() => mockViewer) }));
jest.mock("../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../src/stores/eventStore"),
    getEvent: jest.fn(() => null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh_")),
}));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "111111111111111111") }));
const mockGroups = { list: [] };
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [{ categoryId: "c", categoryName: "Raids", events: mockGroups.list }], error: null, stale: false })),
    eventLookbackSince: jest.fn(() => 0),
}));
const mockRh = { event: null, slots: null, down: false, disabled: false };
const mockClient = {
    getEvent: jest.fn(async () => { if (mockRh.down) throw new Error("Raid-Helper nicht erreichbar"); return mockRh.event; }),
    getSetup: jest.fn(async () => (mockRh.down || !mockRh.slots ? undefined : { raidid: "x", setup: mockRh.slots })),
    createEvent: jest.fn(), signUp: jest.fn(), signUpToRaid: jest.fn(),
};
jest.mock("../../src/utils/raidhelper/client", () => ({
    createRaidhelperClient: jest.fn(() => (mockRh.disabled ? { disabled: true } : mockClient)),
    raidhelperDisabled: jest.fn(() => mockRh.disabled),
}));
const mockSnapshots = {};
jest.mock("../../src/stores/raidEventStore", () => ({ getRaidEvent: jest.fn((id) => mockSnapshots[id] || null), listRaidEvents: jest.fn(() => []) }));
const mockProfiles = {};
jest.mock("../../src/stores/raiderProfileStore", () => ({
    ...jest.requireActual("../../src/stores/raiderProfileStore"),
    getProfile: jest.fn((id) => mockProfiles[id] || null),
}));

const { readJsonBody } = require("../../src/web/apiBody");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/raidplanStore");
const profiles = require("../../src/stores/raidplanProfileStore");
const route = require("../../src/web/apiRoutes/raidplan");
const rosterSource = require("../../src/web/raidplanRosterSource");
const { checkAccess, areasFor } = require("../../src/web/apiAccess");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const EV = "1400000000000000009";

const { mockRes, status, json } = require("../helpers/http");
const body = (r) => { const p = json(r); return p.data || p.error; };
async function call(handler, user, payload, query = "") {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raidplan${query ? `?${query}` : ""}`));
    return r;
}

const slot = (id, name, className, specName, groupNumber) => ({ id, name, className, specName, groupNumber });
const SLOTS = [slot("u1", "Tanknick", "Tank", "Protection", 1), slot("u2", "Heilnick", "Priest", "HolyPriest", 1), slot("u3", "Magenick", "Mage", "Fire", 2)];
const activate = (extra = {}) => call(route.postLink, ORGA, { event: EV, enabled: true, ...extra });
const tokenOf = (u) => ({ id: `t${u}`, userId: u, x: 0.5, y: 0.5 });

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("raidplans.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
    rosterSource._resetForTests();
    mockViewer = null;
    Object.assign(mockRh, { event: { id: EV, title: "BT 25er Montag", signUps: [] }, slots: SLOTS.slice(), down: false, disabled: false });
    mockGroups.list = [{ id: EV, source: "raidhelper", title: "BT 25er Montag", startTime: 1900000000 }];
    for (const k of Object.keys(mockSnapshots)) delete mockSnapshots[k];
    for (const k of Object.keys(mockProfiles)) delete mockProfiles[k];
});
afterAll(() => {
    store.useFile();
    profiles.useFile();
});

describe("the switch", () => {
    it("is under raids: read for GET, write for POST", () => {
        expect(areasFor("/api/raidplan/link")).toEqual(["raids"]);
        expect(checkAccess("/api/raidplan/link", "GET", READER)).toBeNull();
        expect(checkAccess("/api/raidplan/link", "POST", READER)).toMatchObject({ status: 403 });
    });

    it("GET suggests instance and size from the title; the plan answers 409 until it is switched on", async () => {
        const d = body(await call(route.getLink, ORGA, null, `event=${EV}`));
        expect(d).toMatchObject({ eventId: EV, title: "BT 25er Montag", enabled: false, link: null, raidhelperDisabled: false });
        expect(d.suggestion).toEqual({ instanceIds: ["bt"], size: 25, versionId: "tbc" });
        expect(d.instances.map((i) => i.id)).toContain("bt");
        expect(status(await call(route.getPlan, ORGA, null, `event=${EV}`))).toBe(409);
    });

    it("switching on stores instances / size / version / title on the plan record and remembers the line-up; the editor gets Raid-Helper's players", async () => {
        const on = body(await activate());
        expect(on).toMatchObject({ enabled: true, link: { source: "raidhelper", enabled: true, instanceIds: ["bt"], size: 25, versionId: "tbc", title: "BT 25er Montag", guildId: "111111111111111111" } });
        expect(Object.keys(store.getPlan(EV).known)).toEqual(["u1", "u2", "u3"]);
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(d.event).toMatchObject({ id: EV, title: "BT 25er Montag" });
        expect(d.bosses.some((b) => b.key === "bt/illidan-stormrage")).toBe(true);
        expect(d.roster.map((p) => [p.userId, p.character, p.role, p.group])).toEqual([["u1", "Tanknick", "tank", 1], ["u2", "Heilnick", "healer", 1], ["u3", "Magenick", "ranged", 2]]);
        expect(d.rosterSource).toMatchObject({ kind: "raidhelper", origin: "cache", available: true, authoritative: true, hasGroups: true, unmatchedNames: 3, stale: false });
        expect(d.hasApprovedSetup).toBe(true);
        // read only: nothing but reads went to Raid-Helper
        expect(mockClient.createEvent).not.toHaveBeenCalled();
        expect(mockClient.signUp).not.toHaveBeenCalled();
    });

    it("takes a corrected instance / size and refuses no instance at all", async () => {
        expect(body(await activate({ instanceIds: ["kara"], size: 10 })).link).toMatchObject({ instanceIds: ["kara"], size: 10 });
        expect(status(await activate({ instanceIds: [] }))).toBe(400);
        expect(status(await activate({ instanceIds: ["nope"] }))).toBe(400);
    });

    it("refuses own events, unknown events and a reader", async () => {
        expect(status(await call(route.postLink, ORGA, { event: "eh_1", enabled: true }))).toBe(400);
        mockGroups.list = [];
        expect(status(await activate())).toBe(404);
        mockGroups.list = [{ id: EV, source: "raidhelper", title: "BT" }];
        expect(status(await call(route.postLink, READER, { event: EV, enabled: true }))).toBe(403);
    });

    it("switching off keeps the plan but withdraws the public link; switching on again finds it", async () => {
        await activate();
        await call(route.putPlan, ORGA, { event: EV, version: 0, bosses: { "bt/illidan-stormrage": { tokens: [tokenOf("u1")] } } });
        const pub = body(await call(route.postPublish, ORGA, { event: EV, published: true }));
        const token = pub.plan.publicPath.replace("/p/", "");
        const r1 = mockRes();
        await route.getPublic({ headers: {} }, r1, new URL(`http://x/api/raidplan/public?token=${token}`));
        expect(status(r1)).toBe(200);
        expect(body(r1).roster.map((p) => p.userId)).toEqual(["u1"]);

        const off = body(await call(route.postLink, ORGA, { event: EV, enabled: false }));
        expect(off).toMatchObject({ enabled: false, published: false, hasPlan: true });
        const r2 = mockRes();
        await route.getPublic({ headers: {} }, r2, new URL(`http://x/api/raidplan/public?token=${token}`));
        expect(status(r2)).toBe(404);
        expect(status(await call(route.getPlan, ORGA, null, `event=${EV}`))).toBe(409);

        await activate();
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(d.plan.bosses["bt/illidan-stormrage"].tokens.map((t) => t.userId)).toEqual(["u1"]);
        expect(d.plan.status).toBe("draft");
    });

    it("an event plan's own map may be uploaded once the plan is switched on", async () => {
        const { readRawBody } = require("../../src/web/apiBody");
        readRawBody.mockResolvedValue(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]));
        expect(status(await call(route.postMap, ORGA, null, `key=e/${EV}/bt/supremus`))).toBe(404);
        await activate();
        expect(status(await call(route.postMap, ORGA, null, `key=e/${EV}/bt/supremus`))).toBe(200);
        store.deleteMap(`e/${EV}/bt/supremus`);
    });
});

describe("the players come from Raid-Helper, never at the plan's cost", () => {
    it("asks Raid-Helper at most once a minute per event; ?fresh=1 asks again", async () => {
        await activate();
        mockClient.getEvent.mockClear();
        await call(route.getPlan, ORGA, null, `event=${EV}`);
        await call(route.getPlan, ORGA, null, `event=${EV}`);
        expect(mockClient.getEvent).toHaveBeenCalledTimes(0);
        await call(route.getPlan, ORGA, null, `event=${EV}&fresh=1`);
        expect(mockClient.getEvent).toHaveBeenCalledTimes(1);
    });

    it("the cache holds a minute, then Raid-Helper is asked again", async () => {
        const t0 = 1_000_000;
        expect((await rosterSource.rawFor(EV, { now: t0 })).origin).toBe("live");
        expect((await rosterSource.rawFor(EV, { now: t0 + rosterSource.CACHE_MS - 1 })).origin).toBe("cache");
        expect((await rosterSource.rawFor(EV, { now: t0 + rosterSource.CACHE_MS })).origin).toBe("live");
        expect(mockClient.getEvent).toHaveBeenCalledTimes(2);
    });

    it("Raid-Helper down: the last answer, marked stale - and a save keeps every player", async () => {
        await activate();
        mockRh.down = true;
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}&fresh=1`));
        expect(d.rosterSource).toMatchObject({ origin: "last", stale: true, authoritative: false, available: true });
        expect(d.rosterSource.error).toMatch(/nicht erreichbar/);
        // a player the line-up does not know is kept (nobody can tell right now whether he is still in it)
        const saved = body(await call(route.putPlan, ORGA, { event: EV, version: 0, bosses: { "bt/supremus": { tokens: [tokenOf("u1"), tokenOf("u77")] } } }));
        expect(saved.dropped).toBe(0);
        expect(store.getPlan(EV).bosses["bt/supremus"].tokens.map((t) => t.userId)).toEqual(["u1", "u77"]);
    });

    it("after a restart with Raid-Helper down: the line-up the plan remembered ('gespeicherter Stand'); nothing at all -> unavailable", async () => {
        await activate();
        rosterSource._resetForTests();
        mockRh.down = true;
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(d.rosterSource).toMatchObject({ origin: "saved", available: true, stale: true });
        expect(d.roster.map((p) => p.character)).toEqual(["Tanknick", "Heilnick", "Magenick"]);

        store.useFile(tempStoreFile("raidplans2.json"));
        mockRh.down = false;
        await activate();
        rosterSource._resetForTests();
        mockRh.down = true;
        const plan = store.getPlan(EV);
        store.useFile(tempStoreFile("raidplans3.json"));
        store.setLink(EV, { ...plan.link });
        const none = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(none.rosterSource).toMatchObject({ origin: "none", available: false });
        expect(none.hasApprovedSetup).toBe(false);
        expect(none.roster).toEqual([]);
    });

    it("a past raid whose Aufstellung Raid-Helper dropped: the snapshot", async () => {
        await activate();
        mockRh.slots = null;
        mockSnapshots[EV] = { id: EV, setup: [slot("u5", "Snapnick", "Rogue", "Combat", 3)], updatedAt: 5 };
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}&fresh=1`));
        expect(d.rosterSource).toMatchObject({ origin: "snapshot", stale: true, fetchedAt: 5 });
        expect(d.roster.map((p) => p.userId)).toEqual(["u5"]);
    });

    it("Raid-Helper answers but lists nobody: no save drops anybody", async () => {
        await activate();
        await call(route.putPlan, ORGA, { event: EV, version: 0, bosses: { "bt/supremus": { tokens: [tokenOf("u1")] } } });
        mockRh.slots = [];
        mockRh.event = { id: EV, title: "BT", signUps: [] };
        const d = body(await call(route.putPlan, ORGA, { event: EV, version: 1, bosses: { "bt/supremus": { tokens: [tokenOf("u1")] } } }));
        expect(d.dropped).toBe(0);
    });

    it("a raider Raid-Helper no longer lists: shown 'gone' under his last name, kept until a save with a loaded line-up", async () => {
        await activate();
        await call(route.putPlan, ORGA, { event: EV, version: 0, bosses: { "bt/supremus": { tokens: [tokenOf("u1"), tokenOf("u3")] } } });
        mockRh.slots = SLOTS.slice(0, 2);
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}&fresh=1`));
        expect(d.roster.find((p) => p.userId === "u3")).toMatchObject({ character: "Magenick", gone: true, spec: "Mage-Fire" });
        expect(d.rosterSource.goneCount).toBe(1);
        // the public page does not name him
        await call(route.postPublish, ORGA, { event: EV, published: true });
        const token = store.getPlan(EV).publicToken;
        const r = mockRes();
        await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${token}`));
        expect(body(r).roster.map((p) => p.userId)).toEqual(["u1"]);
        // the next save with a loaded line-up drops him
        const saved = body(await call(route.putPlan, ORGA, { event: EV, version: 1, bosses: { "bt/supremus": { tokens: [tokenOf("u1"), tokenOf("u3")] } } }));
        expect(saved.dropped).toBe(1);
        expect(saved.roster.some((p) => p.userId === "u3")).toBe(false);
    });

    it("the character comes from the raider profile (class of Raid-Helper's signup), the Raid-Helper name stays as rhName", async () => {
        mockProfiles.u3 = { userId: "u3", characters: [{ key: "frostmain", name: "Frostmain", className: "Mage", main: true }, { key: "twink", name: "Twink", className: "Warrior", main: false }] };
        await activate();
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(d.roster.find((p) => p.userId === "u3")).toMatchObject({ character: "Frostmain", rhName: "Magenick", spec: "Mage-Fire" });
        expect(d.roster.find((p) => p.userId === "u3").nameFromRh).toBeUndefined();
        expect(d.roster.find((p) => p.userId === "u1")).toMatchObject({ character: "Tanknick", nameFromRh: true });
        expect(d.rosterSource.unmatchedNames).toBe(2);
    });

    it("'Meine Aufgaben' goes by the Discord id", async () => {
        await activate();
        mockUser = { ...ORGA, id: "u2" };
        const d = body(await call(route.getPlan, { ...ORGA, id: "u2" }, null, `event=${EV}`));
        expect(d.meIds).toEqual(["u2"]);
    });

    it("a template applies to it and fills the open slots from Raid-Helper's line-up", async () => {
        const templates = require("../../src/stores/raidplanTemplateStore");
        templates.useFile(tempStoreFile("templates.json"));
        try {
            const t = templates.createTemplate({ name: "BT", instanceIds: ["bt"] }).template;
            templates.updateTemplate(t.id, { version: t.version, bosses: { "bt/supremus": { slots: [{ id: "s1", kind: "tank", n: 1, x: 0.5, y: 0.5 }] } } });
            await activate();
            const d = body(await call(route.postApply, ORGA, { event: EV, templateId: t.id, version: 0 }));
            expect(d.plan.bosses["bt/supremus"].slots[0].userId).toBe("u1");
        } finally {
            templates.useFile();
        }
    });

    it("Raid-Helper switched off in the settings: the plan still opens from its remembered line-up, and says so", async () => {
        await activate();
        rosterSource._resetForTests();
        mockRh.disabled = true;
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(d.rosterSource).toMatchObject({ origin: "saved", disabled: true, available: true });
        expect(body(await call(route.getLink, ORGA, null, `event=${EV}`)).raidhelperDisabled).toBe(true);
    });
});
