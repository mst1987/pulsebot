// Setup & Freigabe for the orga of a raid category (#725, epic #723), through the real router, the
// real gate (apiAccess + withUser `orgaScoped`) and the real rule (services/roster/categoryOrga.js):
// a manager of the roster of category cat1 edits the setups of cat1's raids - not those of cat2 -
// without `raids` write; the global orga stays the orga of every raid, a raider role with `raids`
// write but no orga rank gets 403 orga_only as before. Real event and signup stores on scratch files.
let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => ""),
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../../src/stores/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
// Every category plays TBC now. cat1's TBC roster is managed by the account "mgr" and the role
// "role-mgr"; cat1 has a Forever roster prepared already (open, not current yet) managed by "fmgr" and
// "dual"; "dual" also manages the current roster of cat3. cat2 has no roster.
jest.mock("../../../../src/stores/rosterStore", () => {
    const roster = (id, categoryId, versionId, userIds, roleIds = []) => ({ id, categoryId, versionId, guildId: "g1", managers: { userIds, roleIds }, members: {} });
    const rosters = {
        "cat1:tbc": roster("r1", "cat1", "tbc", ["mgr"], ["role-mgr"]),
        "cat1:forever": roster("r1f", "cat1", "forever", ["fmgr", "dual"]),
        "cat3:tbc": roster("r3", "cat3", "tbc", ["dual"]),
    };
    return {
        listRosters: jest.fn(() => Object.values(rosters)),
        rosterForCategory: jest.fn((cat, version) => rosters[`${cat}:${version}`] || null),
        isClosed: jest.fn(() => false),
    };
});
jest.mock("../../../../src/services/versions/mainVersion", () => ({
    ...jest.requireActual("../../../../src/services/versions/mainVersion"),
    // the raid's own version (versionOfEvent is the one resolver; here its stored field)
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
// who may see which raid is eventVisibility's (its own tests); here every raid is visible
jest.mock("../../../../src/services/signups/eventVisibility", () => ({ userSeesEvent: jest.fn(async () => true) }));
jest.mock("../../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }), attendanceForAccounts: () => new Map() }));
const mockMemberRoleIds = jest.fn(async () => []);
jest.mock("../../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({})),
    avatarUrlFor: () => "",
    listAllChannels: () => [],
    listGuilds: () => [],
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
}));
jest.mock("../../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../../src/services/setup/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 0 })),
    refreshLiveSetup: jest.fn(async () => ({})),
}));

const { tempStoreFile } = require("../../../helpers/tempStore");
const eventStore = require("../../../../src/stores/eventStore");
const signupStore = require("../../../../src/stores/signupStore");
const profileStore = require("../../../../src/stores/raiderProfileStore");
const { emptyAccess } = require("../../../../src/config/permissions");
const route = require("../../../../src/web/apiRoutes/events/setup");
const { routerClient, status, body } = require("../../../helpers/http");

const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const api = routerClient(route);

// a raider: reads raids, no right to write them
const raiderAccess = () => ({ ...emptyAccess(), raids: { read: true, write: false }, signup: { read: true, write: true } });
const MANAGER = { id: "mgr", name: "Manager", isAdmin: false, access: raiderAccess() };
const RAIDER = { id: "raider", name: "Raider", isAdmin: false, access: raiderAccess() };
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true } } };
// `raids` write without an orga rank (a raider role): never the setup editor
const WRITER = { id: "rw", name: "Schreiber", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: true } } };

let own;
let foreign;

function raid(categoryId, title, versionId = "tbc") {
    const event = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId, title, startTime: START, versionId,
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
    for (const [id, spec] of [["t1", "Warrior-Protection"], ["h1", "Priest-Holy"], ["d1", "Mage-Fire"]]) {
        signupStore.saveSignup(event.id, id, { character: id.toUpperCase(), spec, status: "signed" }, { versionId });
    }
    return event;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockMemberRoleIds.mockResolvedValue([]);
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    profileStore.useFile(tempStoreFile("profiles.json"));
    own = raid("cat1", "Karazhan");
    foreign = raid("cat2", "Gruul");
});

const code = (r) => (body(r).error || {}).code;

describe("the orga of a category (a manager of its roster)", () => {
    beforeEach(() => { mockUser = MANAGER; });

    it("edits the setup of a raid of their category, without `raids` write", async () => {
        let r = await api.post("/api/raids/setup/ping-text", { event: own.id, text: "Kommt pünktlich" });
        expect(status(r)).toBe(200);
        expect(body(r).canWrite).toBe(true);

        r = await api.post("/api/raids/setup/extra-role", { event: own.id, userId: "h1", role: "healer", on: true });
        expect(status(r)).toBe(200);

        r = await api.post("/api/raids/setup/propose", { event: own.id });
        expect(status(r)).toBe(200);
        expect(eventStore.getEvent(own.id).setup).toBeTruthy();

        r = await api.get("/api/raids/setup/signup", { event: own.id, user: "h1" });
        expect(status(r)).toBe(200);
    });

    it("is the orga by a manager role on the roster's server as well", async () => {
        mockUser = { ...MANAGER, id: "someone" };
        mockMemberRoleIds.mockResolvedValue(["role-mgr"]);
        const r = await api.post("/api/raids/setup/ping-text", { event: own.id, text: "Hallo" });
        expect(status(r)).toBe(200);
        expect(body(r).canWrite).toBe(true);
    });

    it("gets 403 not_category_orga on every setup route for a raid of another category, and nothing changes", async () => {
        // the other category's raid as its orga left it: posted setup, ping text, an extra healer, a confirmation
        mockUser = ORGA;
        const proposed = body(await api.post("/api/raids/setup/propose", { event: foreign.id }));
        expect(status(await api.post("/api/raids/setup/approve", { event: foreign.id, version: proposed.setup.version }))).toBe(200);
        expect(status(await api.post("/api/raids/setup/ping-text", { event: foreign.id, text: "Pünktlich!" }))).toBe(200);
        expect(status(await api.post("/api/raids/setup/extra-role", { event: foreign.id, userId: "t1", role: "healer", on: true }))).toBe(200);
        expect(status(await api.post("/api/raids/setup/confirm", { event: foreign.id, userId: "t1", status: "confirmed" }))).toBe(200);
        const before = JSON.parse(JSON.stringify(eventStore.getEvent(foreign.id)));
        const signupsBefore = JSON.parse(JSON.stringify(signupStore.listSignups(foreign.id)));

        mockUser = MANAGER;
        const f = foreign.id;
        // every route of the editor that writes or prepares a write - each one, so a new route needs a row here
        const calls = {
            "PUT /api/raids/setup": { event: f, version: before.setup.version, groups: [], bench: [] },
            "POST /api/raids/setup/presence": { event: f, action: { kind: "drag", userId: "h1" } },
            "POST /api/raids/setup/propose": { event: f },
            "POST /api/raids/setup/approve": { event: f, version: before.setup.version },
            "POST /api/raids/setup/post": { event: f },
            "POST /api/raids/setup/ping-text": { event: f, text: "überschrieben" },
            "POST /api/raids/setup/ping": { event: f },
            "POST /api/raids/setup/confirm": { event: f, userId: "t1", status: "declined" },
            "POST /api/raids/setup/confirm-all": { event: f },
            "POST /api/raids/setup/extra-role": { event: f, userId: "t1", role: "healer", on: false },
            "GET /api/raids/setup/signup": { event: f, user: "h1" },
            "PUT /api/raids/setup/signup": { event: f, userId: "h1", status: "absence" },
            "POST /api/raids/setup/search/text": { event: f, roles: { tank: 1 }, buffs: [] },
            "POST /api/raids/setup/search": { event: f, text: "Suchen Heiler" },
            "POST /api/raids/setup/explain": { event: f },
            "GET /api/raids/setup/explain": { event: f },
            "POST /api/raids/setup/move-raid": { event: f, target: f, userId: "h1" },
            "POST /api/raids/setup/raid-add": { event: f },
            "POST /api/raids/setup/raid-remove": { event: f },
        };
        const scoped = route.routes.filter((r) => r.handler.orgaScoped).map((r) => `${r.method} ${r.path}`);
        expect(Object.keys(calls).sort()).toEqual([...scoped].sort());
        for (const [key, payload] of Object.entries(calls)) {
            const [method, path] = key.split(" ");
            const r = method === "GET" ? await api.get(path, payload) : await api.request(method, path, payload);
            expect([key, status(r), code(r)]).toEqual([key, 403, "not_category_orga"]);
        }

        // setup, ping text, extra roles, confirmations, the raid group: all as they were
        expect(eventStore.getEvent(foreign.id)).toEqual(before);
        expect(signupStore.listSignups(foreign.id)).toEqual(signupsBefore);
        expect(before.raidGroupId || "").toBe("");
    });

    it("moves a raider only between raids of their category: a target in another category is refused", async () => {
        const sibling = body(await api.post("/api/raids/setup/raid-add", { event: own.id })).event;
        expect(eventStore.getEvent(sibling).categoryId).toBe("cat1");

        let r = await api.post("/api/raids/setup/move-raid", { event: own.id, target: foreign.id, userId: "h1" });
        expect(status(r)).toBe(403);
        expect(code(r)).toBe("not_category_orga");
        // the source alone in another category refuses too
        r = await api.post("/api/raids/setup/move-raid", { event: foreign.id, target: own.id, userId: "h1" });
        expect(code(r)).toBe("not_category_orga");
        // no target named: refused before anything is looked up
        r = await api.post("/api/raids/setup/move-raid", { event: own.id, userId: "h1" });
        expect(code(r)).toBe("not_category_orga");

        r = await api.post("/api/raids/setup/move-raid", { event: own.id, target: sibling, userId: "h1" });
        expect(status(r)).toBe(200);
        expect(eventStore.getEvent(sibling).setup.groups[0].slots.map((s) => s.userId)).toEqual(["h1"]);
    });

    it("gets the draft and canWrite per event in GET /api/raids/setup", async () => {
        mockUser = ORGA;
        expect(status(await api.post("/api/raids/setup/propose", { event: own.id }))).toBe(200);
        expect(status(await api.post("/api/raids/setup/propose", { event: foreign.id }))).toBe(200);

        mockUser = MANAGER;
        const mine = body(await api.get("/api/raids/setup", { event: own.id }));
        expect(mine.canWrite).toBe(true);
        expect(mine.setup).toBeTruthy();
        const theirs = body(await api.get("/api/raids/setup", { event: foreign.id }));
        expect(theirs.canWrite).toBe(false);
        // a draft is never handed to who could not approve it
        expect(theirs.setup || null).toBeNull();
        // the raid size is the event's own (PATCH /api/raids): theirs since #728, for their raid only
        expect(mine.canEditEvent).toBe(true);
        expect(theirs.canEditEvent).toBe(false);
    });

    it("opens the setup of their raid where they could not sign up (#729); another category's stays 404", async () => {
        const { userSeesEvent } = require("../../../../src/services/signups/eventVisibility");
        userSeesEvent.mockResolvedValue(false);
        try {
            const mine = await api.get("/api/raids/setup", { event: own.id });
            expect(status(mine)).toBe(200);
            expect(body(mine).canWrite).toBe(true);
            expect(status(await api.get("/api/raids/setup", { event: foreign.id }))).toBe(404);
        } finally {
            userSeesEvent.mockResolvedValue(true);
        }
    });
});

// #725 review: the gate counts only the roster a category plays now - canWrite must not say more
describe("the manager of a roster prepared for a coming version (open, not current yet)", () => {
    let forever;
    beforeEach(async () => {
        forever = raid("cat1", "Forever-Raid", "forever");
        mockUser = ORGA;
        expect(status(await api.post("/api/raids/setup/propose", { event: forever.id }))).toBe(200);
    });

    it("gets canWrite false and no draft for a raid of that version", async () => {
        mockUser = { ...MANAGER, id: "fmgr" };
        const view = body(await api.get("/api/raids/setup", { event: forever.id }));
        expect(view.canWrite).toBe(false);
        expect(view.setup || null).toBeNull();
        expect(view.canEditEvent).toBe(false);
        // and is no orga at the gate either
        const r = await api.post("/api/raids/setup/ping-text", { event: forever.id, text: "x" });
        expect(status(r)).toBe(403);
    });

    it("may not write even while managing a current roster elsewhere", async () => {
        mockUser = { ...MANAGER, id: "dual" };
        expect(body(await api.get("/api/raids/setup", { event: forever.id })).canWrite).toBe(false);
        const before = JSON.parse(JSON.stringify(eventStore.getEvent(forever.id)));
        for (const [path, payload] of [
            ["/api/raids/setup/ping-text", { event: forever.id, text: "x" }],
            ["/api/raids/setup/propose", { event: forever.id }],
        ]) {
            const r = await api.post(path, payload);
            expect([path, status(r), code(r)]).toEqual([path, 403, "not_category_orga"]);
        }
        expect(eventStore.getEvent(forever.id)).toEqual(before);
    });
});

describe("the global orga and everybody else", () => {
    it("lets the global orga edit every raid as before, canWrite on both", async () => {
        mockUser = ORGA;
        for (const event of [own, foreign]) {
            const r = await api.post("/api/raids/setup/ping-text", { event: event.id, text: "Hallo" });
            expect(status(r)).toBe(200);
            expect(body(r).canWrite).toBe(true);
            const view = body(await api.get("/api/raids/setup", { event: event.id }));
            expect(view.canWrite).toBe(true);
            expect(view.canEditEvent).toBe(true);
        }
        // no roster was asked for the global orga
        expect(mockMemberRoleIds).not.toHaveBeenCalled();
    });

    it("gives a global orga without `raids` write who manages a roster canWrite per event, as the gate does", async () => {
        mockUser = { ...MANAGER, isOrga: true };
        const mine = body(await api.get("/api/raids/setup", { event: own.id }));
        expect(mine.canWrite).toBe(true);
        // PATCH /api/raids takes the same category path (#728)
        expect(mine.canEditEvent).toBe(true);
        expect(body(await api.get("/api/raids/setup", { event: foreign.id })).canWrite).toBe(false);
        expect(status(await api.post("/api/raids/setup/ping-text", { event: own.id, text: "Hallo" }))).toBe(200);
        expect(code(await api.post("/api/raids/setup/ping-text", { event: foreign.id, text: "x" }))).toBe("not_category_orga");
    });

    it("refuses a raider role with `raids` write but no orga rank with orga_only, canWrite false", async () => {
        mockUser = WRITER;
        for (const event of [own, foreign]) {
            const r = await api.post("/api/raids/setup/ping-text", { event: event.id, text: "x" });
            expect(status(r)).toBe(403);
            expect(code(r)).toBe("orga_only");
            expect(body(await api.get("/api/raids/setup", { event: event.id })).canWrite).toBe(false);
        }
    });

    it("refuses a raider who manages no roster: the area gate stays shut", async () => {
        mockUser = RAIDER;
        const r = await api.post("/api/raids/setup/ping-text", { event: own.id, text: "x" });
        expect(status(r)).toBe(403);
        expect(code(r)).toBe("forbidden");
        expect(body(await api.get("/api/raids/setup", { event: own.id })).canWrite).toBe(false);
    });
});
