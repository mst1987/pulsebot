// Managing the signups of a raid as the orga of its category (#727, epic #723), through the real router,
// the real gate (apiAccess + withUser `orgaScoped`) and the real rule (services/roster/categoryOrga.js):
// a manager of the roster of category cat1 closes/opens the signup, signs raiders up and off, posts the
// Anmelde-Aufruf, pings the missing raiders and calls the invites - for cat1's raids, not for cat2's -
// without `raids` write; the global orga stays the orga of every raid, a raider role with `raids` write
// but no orga rank gets 403 orga_only as before. Moving, cancelling, deleting, the channel, sheet, softres
// and loot system are #728's (events.categoryOrga.test.js). The services behind the routes are mocked (their own
// tests); the events and signups are real stores on scratch files.
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
jest.mock("../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settingsStore"),
    getConfig: () => ({}),
    getNotify: (id) => (id === "tpl" ? { id: "tpl", title: "Anmelden!", body: "Bitte anmelden." } : null),
}));
// Every category plays TBC now. cat1's TBC roster is managed by the account "mgr" and the role
// "role-mgr"; cat1 has a Forever roster prepared already (open, not current yet) managed by "fmgr".
// cat2 has no roster.
jest.mock("../../../src/stores/rosterStore", () => {
    // every roster's raider role is "r-raider" (the roles a category orga may ping in the Anmelde-Aufruf)
    const roster = (id, categoryId, versionId, userIds, roleIds = []) => ({ id, categoryId, versionId, guildId: "g1", managers: { userIds, roleIds }, roleIds: ["r-raider"], members: {} });
    const rosters = {
        "cat1:tbc": roster("r1", "cat1", "tbc", ["mgr"], ["role-mgr"]),
        "cat1:forever": roster("r1f", "cat1", "forever", ["fmgr"]),
    };
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
    knownVersion: jest.fn((v) => v || ""),
}));
const mockMemberRoleIds = jest.fn(async () => []);
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
    postAnnouncement: jest.fn(async () => ({})),
    resolveUserNames: jest.fn(async () => ({})),
    listRoles: () => [],
}));
// the raid list of the server (resolveEventForPost): the stored events, with their channels
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    ...jest.requireActual("../../../src/services/events/raidEventGroups"),
    loadEventGroups: jest.fn(async () => {
        const events = require("../../../src/stores/eventStore").listEvents("");
        const byCat = new Map();
        for (const e of events) {
            if (!byCat.has(e.categoryId)) byCat.set(e.categoryId, { categoryId: e.categoryId, events: [] });
            byCat.get(e.categoryId).events.push({ id: e.id, channelId: e.channelId, title: e.title, startTime: e.startTime, categoryId: e.categoryId });
        }
        return { groups: [...byCat.values()], error: null };
    }),
}));
jest.mock("../../../src/services/events/eventManage", () => ({
    manageInfo: jest.fn(async () => ({ status: 200, body: {} })),
    movePlan: jest.fn(async () => ({ plan: {} })),
    moveEvent: jest.fn(async () => ({ status: 200, body: {} })),
    setSignupsOpen: jest.fn(async () => ({ status: 200, body: { message: "ok" } })),
    raiderCandidates: jest.fn(async () => ({ status: 200, body: { raiders: [], classes: [] } })),
    addRaider: jest.fn(async () => ({ status: 200, body: { message: "angemeldet" } })),
    removeRaider: jest.fn(async () => ({ status: 200, body: { message: "ausgetragen" } })),
    cancelEvent: jest.fn(async () => ({ status: 200, body: {} })),
    reopenEvent: jest.fn(async () => ({ status: 200, body: {} })),
    deleteEvent: jest.fn(async () => ({ status: 200, body: {} })),
    recreateChannel: jest.fn(async () => ({ status: 200, body: {} })),
}));
jest.mock("../../../src/services/events/missingPing", () => ({ pingMissingRaiders: jest.fn(async () => ({ message: "gepingt" })) }));
jest.mock("../../../src/services/setup/inviteCall", () => ({
    invitePlan: jest.fn(() => ({ userIds: ["u1"], text: "/w X inv", groups: [1] })),
    callInvite: jest.fn(async () => ({ message: "gerufen", count: 1, text: "/w X inv" })),
}));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const { emptyAccess } = require("../../../src/config/permissions");
const discord = require("../../../src/services/discord/discord");
const manage = require("../../../src/services/events/eventManage");
const { pingMissingRaiders } = require("../../../src/services/events/missingPing");
const { callInvite } = require("../../../src/services/setup/inviteCall");
const manageRoutes = require("../../../src/web/apiRoutes/eventManage");
const detailRoutes = require("../../../src/web/apiRoutes/raidDetail");
const { routerClient, status, body } = require("../../helpers/http");

const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const manageApi = routerClient(manageRoutes);
const detailApi = routerClient(detailRoutes);

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

const code = (r) => (body(r).error || {}).code;
const api = (path) => (path.startsWith("/api/raids/manage") ? manageApi : detailApi);
const send = (method, path, payload) => (method === "GET" ? api(path).get(path, payload) : api(path).request(method, path, payload));

// one call per route this part opens to the orga of a category - the table below is checked against the route lists
const callsFor = (event) => ({
    "POST /api/raids/manage/signups": { event, open: false },
    "GET /api/raids/manage/raider": { event },
    "POST /api/raids/manage/raider": { event, userId: "200000000000000001", character: "Neu", spec: "Mage-Fire" },
    "POST /api/raids/manage/raider/remove": { event, userId: "h1" },
    "POST /api/raids/notify": { event, templateId: "tpl", channelId: "c-elsewhere", roleIds: [], target: "event" },
    "POST /api/raids/ping-missing": { event, text: "Bitte anmelden" },
    "POST /api/raids/invite-call": { event },
});

describe("the orga of a category (a manager of its roster)", () => {
    beforeEach(() => { mockUser = MANAGER; });

    it("manages the signups of a raid of their category, without `raids` write", async () => {
        for (const [key, payload] of Object.entries(callsFor(own.id))) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            expect([key, status(r)]).toEqual([key, 200]);
        }
        expect(manage.setSignupsOpen).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id, open: false, user: MANAGER }));
        expect(manage.raiderCandidates).toHaveBeenCalledWith({ guildId: "g1", eventId: own.id });
        expect(manage.addRaider).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id, character: "Neu" }));
        expect(manage.removeRaider).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id, userId: "h1" }));
        expect(pingMissingRaiders).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id }));
        expect(callInvite).toHaveBeenCalledWith(expect.objectContaining({ eventId: own.id, userId: "mgr" }));
    });

    it("posts the Anmelde-Aufruf into their raid's own channel, whatever channel the request names", async () => {
        const r = await detailApi.post("/api/raids/notify", { event: own.id, templateId: "tpl", channelId: "c-elsewhere", roleIds: ["r-raider"], target: "event" });
        expect(status(r)).toBe(200);
        expect(discord.postAnnouncement).toHaveBeenCalledWith("c-kara", expect.objectContaining({ id: "tpl" }), ["r-raider"]);
    });

    it("pings only the raider roles of the raid's category: any other role refuses the whole call", async () => {
        for (const roleIds of [["r-other"], ["r-raider", "r-other"], ["role-mgr"]]) {
            const r = await detailApi.post("/api/raids/notify", { event: own.id, templateId: "tpl", roleIds, target: "event" });
            expect([roleIds, status(r), code(r)]).toEqual([roleIds, 400, "role_not_allowed"]);
        }
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
        // the own role and no role at all are fine
        expect(status(await detailApi.post("/api/raids/notify", { event: own.id, templateId: "tpl", roleIds: ["r-raider"], target: "event" }))).toBe(200);
        expect(status(await detailApi.post("/api/raids/notify", { event: own.id, templateId: "tpl", target: "event" }))).toBe(200);
        expect(discord.postAnnouncement.mock.calls.map((c) => c[2])).toEqual([["r-raider"], []]);
    });

    it("is the orga by a manager role on the roster's server as well", async () => {
        mockUser = { ...MANAGER, id: "someone" };
        mockMemberRoleIds.mockResolvedValue(["role-mgr"]);
        expect(status(await manageApi.post("/api/raids/manage/signups", { event: own.id, open: true }))).toBe(200);
    });

    it("gets 403 not_category_orga on every route of this part for a raid of another category, and nothing changes", async () => {
        const before = JSON.parse(JSON.stringify(eventStore.getEvent(foreign.id)));
        const signupsBefore = JSON.parse(JSON.stringify(signupStore.listSignups(foreign.id)));
        const calls = callsFor(foreign.id);
        // raidDetail.js also holds the raid plan's post (#726, covered in raidplan.categoryOrga.test.js), both
        // files the event part's routes (#728, covered in events.categoryOrga.test.js)
        const otherPart = new Set([
            "POST /api/raids/post-raidplan",
            "GET /api/raids/manage", "GET /api/raids/manage/move", "POST /api/raids/manage/move", "POST /api/raids/manage/cancel",
            "POST /api/raids/manage/reopen", "POST /api/raids/manage/delete", "POST /api/raids/manage/recreate-channel",
            "POST /api/raids/fill", "POST /api/raids/post-sheet", "POST /api/raids/post-softres", "GET /api/raids/softres/item-search",
            "POST /api/raids/softres", "POST /api/raids/softres/link", "POST /api/raids/loot-system",
        ]);
        const scoped = [...manageRoutes.routes, ...detailRoutes.routes].filter((r) => r.handler.orgaScoped).map((r) => `${r.method} ${r.path}`)
            .filter((key) => !otherPart.has(key));
        expect(Object.keys(calls).sort()).toEqual([...scoped].sort());
        for (const [key, payload] of Object.entries(calls)) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            expect([key, status(r), code(r)]).toEqual([key, 403, "not_category_orga"]);
        }
        expect(eventStore.getEvent(foreign.id)).toEqual(before);
        expect(signupStore.listSignups(foreign.id)).toEqual(signupsBefore);
        for (const fn of [manage.setSignupsOpen, manage.raiderCandidates, manage.addRaider, manage.removeRaider, discord.postAnnouncement, pingMissingRaiders, callInvite]) {
            expect(fn).not.toHaveBeenCalled();
        }
    });

    it("names no event: refused before anything is looked up", async () => {
        const r = await manageApi.post("/api/raids/manage/signups", { open: false });
        expect(code(r)).toBe("not_category_orga");
        expect(code(await detailApi.post("/api/raids/notify", { templateId: "tpl", channelId: "c-kara", target: "event" }))).toBe("not_category_orga");
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
    });

});

describe("the manager of a roster prepared for a coming version (open, not current yet)", () => {
    it("is no orga of a raid of that version", async () => {
        const forever = raid("cat1", "Forever-Raid", "c-fe", "forever");
        mockUser = { ...MANAGER, id: "fmgr" };
        const r = await manageApi.post("/api/raids/manage/signups", { event: forever.id, open: false });
        expect(status(r)).toBe(403);
        expect(manage.setSignupsOpen).not.toHaveBeenCalled();
    });
});

describe("the global orga and everybody else", () => {
    it("lets the global orga manage every raid as before, the channel as the request names it", async () => {
        mockUser = ORGA;
        for (const event of [own, foreign]) {
            for (const [key, payload] of Object.entries(callsFor(event.id))) {
                const [method, path] = key.split(" ");
                expect([key, status(await send(method, path, payload))]).toEqual([key, 200]);
            }
        }
        expect(discord.postAnnouncement).toHaveBeenCalledWith("c-elsewhere", expect.anything(), []);
        // any role of the server, as before
        const r = await detailApi.post("/api/raids/notify", { event: own.id, templateId: "tpl", channelId: "c-elsewhere", roleIds: ["r-other"], target: "event" });
        expect(status(r)).toBe(200);
        expect(discord.postAnnouncement).toHaveBeenLastCalledWith("c-elsewhere", expect.anything(), ["r-other"]);
        // no roster was asked for the global orga
        expect(mockMemberRoleIds).not.toHaveBeenCalled();
    });

    it("refuses a raider role with `raids` write but no orga rank with orga_only", async () => {
        mockUser = WRITER;
        for (const [key, payload] of Object.entries(callsFor(own.id))) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            expect([key, status(r), code(r)]).toEqual([key, 403, "orga_only"]);
        }
    });

    it("refuses a raider who manages no roster: the area gate stays shut", async () => {
        mockUser = RAIDER;
        for (const [key, payload] of Object.entries(callsFor(own.id))) {
            const [method, path] = key.split(" ");
            const r = await send(method, path, payload);
            // a write stops at the area gate; the read passes it (`raids` read) and stops at the orga
            expect([key, status(r), code(r)]).toEqual([key, 403, method === "GET" ? "orga_only" : "forbidden"]);
        }
        expect(manage.setSignupsOpen).not.toHaveBeenCalled();
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
    });
});
