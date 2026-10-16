// The raid plan at the event for the orga of a raid category (#726, epic #723), through the real router,
// the real gate (apiAccess + withUser `orgaScoped` + `globalByWrite`) and the real rule
// (services/roster/categoryOrga.js): a manager of the roster of category cat1 edits, publishes and posts
// the plans of cat1's raids - not those of cat2 - without `raidplan` write; `raidplan` write stays the
// right for every raid (orga rank or not), templates, tactic profiles, the catalog and the default maps
// stay with it alone. Real event, plan, profile and template stores on scratch files.
const { EventEmitter } = require("events");

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
// Every category plays TBC now. cat1's TBC roster is managed by the account "mgr" and the role
// "role-mgr"; cat2 has no roster.
jest.mock("../../../src/stores/rosterStore", () => {
    const roster = (id, categoryId, versionId, userIds, roleIds = []) => ({ id, categoryId, versionId, guildId: "g1", managers: { userIds, roleIds }, members: {}, roleIds: [] });
    const rosters = { "cat1:tbc": roster("r1", "cat1", "tbc", ["mgr"], ["role-mgr"]) };
    return {
        listRosters: jest.fn(() => Object.values(rosters)),
        rosterForCategory: jest.fn((cat, version) => rosters[`${cat}:${version}`] || null),
        isClosed: jest.fn(() => false),
    };
});
jest.mock("../../../src/services/events/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/events/mainVersion"),
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
}));
// who may see which raid is eventVisibility's (its own tests); steered here
let mockSees = true;
jest.mock("../../../src/services/signups/eventVisibility", () => ({
    ...jest.requireActual("../../../src/services/signups/eventVisibility"),
    userSeesEvent: jest.fn(async () => mockSees),
}));
const mockMemberRoleIds = jest.fn(async () => []);
jest.mock("../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({})),
    listAllChannels: () => [],
    listGuilds: () => [],
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
}));
// posting into Discord is raidplanPost's (its own tests)
jest.mock("../../../src/services/raidplan/raidplanPost", () => ({
    postRaidplanLink: jest.fn(async () => ({ body: { message: "gepostet" } })),
    syncRaidplanPost: jest.fn(async () => null),
    raidplanPostState: jest.fn(() => null),
}));
// the raid detail's payload is raidDetailView's (its own tests): here only what the route hands it
jest.mock("../../../src/web/events/raidDetailView", () => ({ buildRaidDetail: jest.fn(async ({ eventId, planPost }) => ({ body: { eventId, planPost } })) }));
// Raid-Helper events: the snapshot (raidEventStore), the event groups and the client - all steered here
const mockSnapshots = {};
jest.mock("../../../src/stores/raidEventStore", () => ({ getRaidEvent: jest.fn((id) => mockSnapshots[id] || null), listRaidEvents: jest.fn(() => []) }));
const mockGroups = { list: [] };
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: mockGroups.list, error: null, stale: false })),
    eventLookbackSince: jest.fn(() => 0),
}));
jest.mock("../../../src/utils/raidhelper/client", () => ({
    createRaidhelperClient: jest.fn(() => ({ getEvent: jest.fn(async () => null), getSetup: jest.fn(async () => undefined) })),
    raidhelperDisabled: jest.fn(() => false),
}));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventStore = require("../../../src/stores/eventStore");
const planStore = require("../../../src/stores/raidplanStore");
const profileStore = require("../../../src/stores/raidplanProfileStore");
const templateStore = require("../../../src/stores/raidplanTemplateStore");
const settingsStore = require("../../../src/stores/settingsStore");
const rosterSource = require("../../../src/web/raidplan/raidplanRosterSource");
const { emptyAccess } = require("../../../src/config/permissions");
const route = require("../../../src/web/apiRoutes/raidplan");
const detailRoute = require("../../../src/web/apiRoutes/raidDetail");
const { routerClient, mockRes, status, body } = require("../../helpers/http");

const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const api = routerClient(route);
const detail = routerClient(detailRoute);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const BOSS = "bt/supremus";
const RH_OWN = "1400000000000000001";
const RH_FOREIGN = "1400000000000000002";

// a raider: reads raids and raid plans, writes neither
const raiderAccess = () => ({ ...emptyAccess(), raids: { read: true, write: false }, raidplan: { read: true, write: false }, signup: { read: true, write: true } });
const MANAGER = { id: "mgr", name: "Manager", isAdmin: false, access: raiderAccess() };
const RAIDER = { id: "raider", name: "Raider", isAdmin: false, access: raiderAccess() };
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true }, raidplan: { read: true, write: true } } };
// `raidplan` write without an orga rank: the people who write the tactics - every raid's plan, as before
const TACTICIAN = { id: "tac", name: "Taktiker", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: false }, raidplan: { read: true, write: true } } };

let own;
let foreign;

function raid(categoryId, title) {
    return eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId, title, startTime: START, versionId: "tbc", instanceIds: ["bt"],
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
}

/** POST /api/raidplan/map?key=<key> with the image as the raw body - through the real router. */
async function uploadMap(key) {
    const req = new EventEmitter();
    Object.assign(req, { method: "POST", url: `/api/raidplan/map?key=${key}`, headers: { "x-csrf-token": "tok" }, destroy: jest.fn() });
    const on = req.on.bind(req);
    let sent = false;
    req.on = (name, listener) => {
        on(name, listener);
        if (name === "end" && !sent) {
            sent = true;
            Promise.resolve().then(() => { req.emit("data", PNG); req.emit("end"); });
        }
        return req;
    };
    const res = mockRes();
    await api.handle("/api/raidplan/map", req, res, new URL(`http://localhost/api/raidplan/map?key=${encodeURIComponent(key)}`));
    return res;
}

const code = (r) => (body(r).error || {}).code;
const realConfig = settingsStore.getConfig();

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(settingsStore, "getConfig").mockReturnValue({ ...realConfig, categoryIds: [], categoryRoles: {} });
    mockMemberRoleIds.mockResolvedValue([]);
    mockSees = true;
    eventStore.useFile(tempStoreFile("events.json"));
    planStore.useFile(tempStoreFile("raidplans.json"));
    profileStore.useFile(tempStoreFile("profiles.json"));
    templateStore.useFile(tempStoreFile("templates.json"));
    rosterSource._resetForTests();
    for (const k of Object.keys(mockSnapshots)) delete mockSnapshots[k];
    own = raid("cat1", "Black Temple");
    foreign = raid("cat2", "Black Temple II");
    mockGroups.list = [
        { categoryId: "cat1", events: [{ id: own.id, source: "own", title: own.title, startTime: START, channelId: "c1" }, { id: RH_OWN, source: "raidhelper", title: "BT 25er", startTime: START }] },
        { categoryId: "cat2", events: [{ id: foreign.id, source: "own", title: foreign.title, startTime: START, channelId: "c1" }, { id: RH_FOREIGN, source: "raidhelper", title: "BT 25er", startTime: START }] },
    ];
});
afterAll(() => {
    planStore.useFile();
    profileStore.useFile();
    templateStore.useFile();
});

describe("the orga of a category (a manager of its roster)", () => {
    beforeEach(() => { mockUser = MANAGER; });

    it("edits, publishes and posts the plan of a raid of their category, without `raidplan` write", async () => {
        let r = await api.request("PUT", "/api/raidplan", { event: own.id, version: 0, bosses: { [BOSS]: { notes: "Tanks links" } } });
        expect(status(r)).toBe(200);
        expect(body(r).canWrite).toBe(true);
        // the shared library is not theirs: no button for it in the answer
        expect(body(r).canWriteLibrary).toBe(false);
        expect(planStore.getPlan(own.id).bosses[BOSS].notes).toBe("Tanks links");

        expect(status(await api.post("/api/raidplan/suggest", { event: own.id, type: "tank", slots: [] }))).toBe(200);
        r = await api.post("/api/raidplan/publish", { event: own.id, published: true });
        expect(status(r)).toBe(200);
        expect(planStore.getPlan(own.id).status).toBe("published");
        expect(status(await api.post("/api/raidplan/groups", { event: own.id, includedGroups: [1] }))).toBe(200);
        expect(status(await uploadMap(`e/${own.id}/${BOSS}`))).toBe(200);
        expect(status(await api.post("/api/raidplan/map/delete", { key: `e/${own.id}/${BOSS}` }))).toBe(200);
        expect(status(await detail.post("/api/raids/post-raidplan", { event: own.id }))).toBe(200);

        const template = templateStore.createTemplate({ name: "BT Standard", instanceIds: ["bt"], versionId: "tbc" }).template;
        r = await api.post("/api/raidplan/apply", { event: own.id, templateId: template.id, version: planStore.getPlan(own.id).version });
        expect(status(r)).toBe(200);
        expect(planStore.getPlan(own.id).templateId).toBe(template.id);
    });

    it("is the orga by a manager role on the roster's server as well", async () => {
        mockUser = { ...MANAGER, id: "someone" };
        mockMemberRoleIds.mockResolvedValue(["role-mgr"]);
        const r = await api.request("PUT", "/api/raidplan", { event: own.id, version: 0, bosses: {} });
        expect(status(r)).toBe(200);
    });

    it("gets 403 not_category_orga on every event route for a raid of another category, and nothing changes", async () => {
        // the other category's plan as its orga left it: saved, published, a group choice, its own map
        mockUser = ORGA;
        expect(status(await api.request("PUT", "/api/raidplan", { event: foreign.id, version: 0, bosses: { [BOSS]: { notes: "Fremd" } } }))).toBe(200);
        expect(status(await api.post("/api/raidplan/publish", { event: foreign.id, published: true }))).toBe(200);
        expect(status(await api.post("/api/raidplan/groups", { event: foreign.id, includedGroups: [1, 2] }))).toBe(200);
        expect(status(await uploadMap(`e/${foreign.id}/${BOSS}`))).toBe(200);
        const template = templateStore.createTemplate({ name: "BT Standard", instanceIds: ["bt"], versionId: "tbc" }).template;
        const before = JSON.parse(JSON.stringify(planStore.getPlan(foreign.id)));
        const mapBefore = planStore.mapVersion(`e/${foreign.id}/${BOSS}`);
        expect(mapBefore).toBeTruthy();

        mockUser = MANAGER;
        const f = foreign.id;
        // every orgaScoped route of the plan - each one, so a new route needs a row here
        const calls = {
            "PUT /api/raidplan": () => api.request("PUT", "/api/raidplan", { event: f, version: before.version, bosses: {} }),
            "POST /api/raidplan/suggest": () => api.post("/api/raidplan/suggest", { event: f, type: "tank", slots: [] }),
            "POST /api/raidplan/publish": () => api.post("/api/raidplan/publish", { event: f, published: false }),
            "POST /api/raidplan/groups": () => api.post("/api/raidplan/groups", { event: f, includedGroups: null }),
            "POST /api/raidplan/map": () => uploadMap(`e/${f}/${BOSS}`),
            "POST /api/raidplan/map/delete": () => api.post("/api/raidplan/map/delete", { key: `e/${f}/${BOSS}` }),
            "POST /api/raidplan/apply": () => api.post("/api/raidplan/apply", { event: f, templateId: template.id, version: before.version }),
            "POST /api/raidplan/link": () => api.post("/api/raidplan/link", { event: RH_FOREIGN, enabled: true }),
            "POST /api/raids/post-raidplan": () => detail.post("/api/raids/post-raidplan", { event: f }),
        };
        // raidDetail.js also holds the signup part's routes (#727, covered in eventManage.categoryOrga.test.js)
        // and the event part's (#728, covered in events.categoryOrga.test.js)
        const otherPart = new Set([
            "POST /api/raids/invite-call", "POST /api/raids/notify", "POST /api/raids/ping-missing",
            "POST /api/raids/fill", "POST /api/raids/post-sheet", "POST /api/raids/post-softres", "GET /api/raids/softres/item-search",
            "POST /api/raids/softres", "POST /api/raids/softres/link", "POST /api/raids/loot-system",
        ]);
        const scoped = [...route.routes, ...detailRoute.routes].filter((r) => r.handler.orgaScoped).map((r) => `${r.method} ${r.path}`)
            .filter((key) => !otherPart.has(key));
        expect(Object.keys(calls).sort()).toEqual([...scoped].sort());
        for (const [key, send] of Object.entries(calls)) {
            const r = await send();
            expect([key, status(r), code(r)]).toEqual([key, 403, "not_category_orga"]);
        }

        // plan, publication, groups, map and the Raid-Helper switch: all as they were
        expect(planStore.getPlan(foreign.id)).toEqual(before);
        expect(planStore.mapVersion(`e/${foreign.id}/${BOSS}`)).toBe(mapBefore);
        expect(planStore.getPlan(RH_FOREIGN)).toBeFalsy();
        expect(require("../../../src/services/raidplan/raidplanPost").postRaidplanLink).not.toHaveBeenCalled();
    });

    it("may not touch the library: templates, tactic profiles, catalog and default maps answer 403 forbidden", async () => {
        const calls = [
            () => api.post("/api/raidplan/templates", { name: "Neu", instanceIds: ["bt"] }),
            () => api.request("PATCH", "/api/raidplan/templates", { id: "x", name: "Neu" }),
            () => api.post("/api/raidplan/templates/duplicate", { id: "x" }),
            () => api.request("DELETE", "/api/raidplan/templates", { id: "x" }),
            () => api.post("/api/raidplan/profiles", { name: "Taktik" }),
            () => api.request("PATCH", "/api/raidplan/profiles", { id: "x", name: "Taktik" }),
            () => api.request("DELETE", "/api/raidplan/profiles", { id: "x" }),
            () => api.post("/api/raidplan/catalog/mobs", { name: "Mob" }),
            () => api.post("/api/raidplan/catalog/reset", { kind: "mobs", id: "x" }),
        ];
        for (const send of calls) {
            const r = await send();
            expect([status(r), code(r)]).toEqual([403, "forbidden"]);
        }
        expect(templateStore.listTemplates()).toEqual([]);
        expect(profileStore.listProfiles()).toEqual([]);
        // a default map (boss, instance) and a template's map are the library's: no event named, refused
        for (const key of [BOSS, "bt", "t/abcdef/bt/supremus"]) {
            const r = await uploadMap(key);
            expect([key, status(r), code(r)]).toEqual([key, 403, "not_category_orga"]);
            const d = await api.post("/api/raidplan/map/delete", { key });
            expect([key, status(d), code(d)]).toEqual([key, 403, "not_category_orga"]);
        }
        expect(planStore.mapVersion(BOSS)).toBeFalsy();
        // a suggestion without an event is the template editor's
        expect(code(await api.post("/api/raidplan/suggest", { type: "tank", slots: [] }))).toBe("not_category_orga");
    });

    it("gets canWrite per event in GET /api/raidplan, and opens their raid even where they could not sign up", async () => {
        const mine = body(await api.get("/api/raidplan", { event: own.id }));
        expect(mine.canWrite).toBe(true);
        expect(mine.canWriteLibrary).toBe(false);
        const theirs = body(await api.get("/api/raidplan", { event: foreign.id }));
        expect(theirs.canWrite).toBe(false);

        mockSees = false;
        expect(status(await api.get("/api/raidplan", { event: own.id }))).toBe(200);
        expect(status(await api.get("/api/raidplan", { event: foreign.id }))).toBe(404);
    });

    it("gets the Einteilungen step only for a raid of their category (GET /api/raids/detail builds with planPost)", async () => {
        expect(body(await detail.get("/api/raids/detail", { event: own.id })).planPost).toBe(true);
        expect(body(await detail.get("/api/raids/detail", { event: foreign.id })).planPost).toBe(false);
        mockUser = TACTICIAN;
        expect(body(await detail.get("/api/raids/detail", { event: foreign.id })).planPost).toBe(true);
        mockUser = RAIDER;
        expect(body(await detail.get("/api/raids/detail", { event: own.id })).planPost).toBe(false);
    });
});

describe("a Raid-Helper event with the raid plan switched on", () => {
    beforeEach(() => { mockUser = MANAGER; });

    it("belongs to the category of its snapshot", async () => {
        mockSnapshots[RH_OWN] = { id: RH_OWN, categoryId: "cat1", title: "BT 25er", startTime: START };
        mockSnapshots[RH_FOREIGN] = { id: RH_FOREIGN, categoryId: "cat2", title: "BT 25er", startTime: START };
        // the event groups say nothing here: the snapshot alone decides
        mockGroups.list = [];
        const before = planStore.getPlan(RH_OWN);
        expect(code(await api.post("/api/raidplan/link", { event: RH_FOREIGN, enabled: false }))).toBe("not_category_orga");
        expect(planStore.getPlan(RH_OWN)).toEqual(before);
        // switching off a plan that was never on answers past the gate (404: Raid-Helper no longer lists it)
        expect(status(await api.post("/api/raidplan/link", { event: RH_OWN, enabled: false }))).toBe(404);
    });

    it("without a snapshot belongs to its group's category: switched on and planned by its orga", async () => {
        let r = await api.post("/api/raidplan/link", { event: RH_OWN, enabled: true, instanceIds: ["bt"], size: 25, versionId: "tbc" });
        expect(status(r)).toBe(200);
        expect(body(r).enabled).toBe(true);
        r = await api.get("/api/raidplan", { event: RH_OWN });
        expect(status(r)).toBe(200);
        expect(body(r).canWrite).toBe(true);
        expect(status(await api.request("PUT", "/api/raidplan", { event: RH_OWN, version: body(r).plan.version, bosses: {} }))).toBe(200);

        expect(code(await api.post("/api/raidplan/link", { event: RH_FOREIGN, enabled: true }))).toBe("not_category_orga");
        expect(planStore.getPlan(RH_FOREIGN)).toBeFalsy();
    });
});

describe("`raidplan` write, the global orga and everybody else", () => {
    it("lets `raidplan` write plan every raid as before, orga rank or not, the library included", async () => {
        for (const user of [ORGA, TACTICIAN]) {
            mockUser = user;
            for (const event of [own, foreign]) {
                const r = await api.request("PUT", "/api/raidplan", { event: event.id, version: (planStore.getPlan(event.id) || { version: 0 }).version, bosses: {} });
                expect([user.id, status(r)]).toEqual([user.id, 200]);
                const view = body(await api.get("/api/raidplan", { event: event.id }));
                expect(view.canWrite).toBe(true);
                expect(view.canWriteLibrary).toBe(true);
            }
            expect(status(await api.post("/api/raidplan/profiles", { name: `Taktik ${user.id}` }))).toBe(200);
            expect(status(await uploadMap(BOSS))).toBe(200);
            expect(status(await detail.post("/api/raids/post-raidplan", { event: foreign.id }))).toBe(200);
        }
        // nobody's roster was asked for them
        expect(mockMemberRoleIds).not.toHaveBeenCalled();
    });

    it("gives a global orga without `raidplan` write who manages a roster the plans of that category only", async () => {
        mockUser = { ...MANAGER, isOrga: true };
        expect(status(await api.request("PUT", "/api/raidplan", { event: own.id, version: 0, bosses: {} }))).toBe(200);
        expect(code(await api.request("PUT", "/api/raidplan", { event: foreign.id, version: 0, bosses: {} }))).toBe("not_category_orga");
        expect(body(await api.get("/api/raidplan", { event: own.id })).canWrite).toBe(true);
        expect(body(await api.get("/api/raidplan", { event: foreign.id })).canWrite).toBe(false);
    });

    it("keeps a raider out: the area gate stays shut, canWrite false", async () => {
        mockUser = RAIDER;
        for (const event of [own, foreign]) {
            const r = await api.request("PUT", "/api/raidplan", { event: event.id, version: 0, bosses: {} });
            expect([status(r), code(r)]).toEqual([403, "forbidden"]);
            const view = body(await api.get("/api/raidplan", { event: event.id }));
            expect(view.canWrite).toBe(false);
            expect(view.canWriteLibrary).toBe(false);
        }
        expect(code(await detail.post("/api/raids/post-raidplan", { event: own.id }))).toBe("forbidden");
        expect(planStore.getPlan(own.id)).toBeFalsy();
    });
});
