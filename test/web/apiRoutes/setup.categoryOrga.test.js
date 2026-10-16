// Setup & Freigabe for the orga of a raid category (#725, epic #723), through the real router, the
// real gate (apiAccess + withUser `orgaScoped`) and the real rule (services/roster/categoryOrga.js):
// a manager of the roster of category cat1 edits the setups of cat1's raids - not those of cat2 -
// without `raids` write; the global orga stays the orga of every raid, a raider role with `raids`
// write but no orga rank gets 403 orga_only as before. Real event and signup stores on scratch files.
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
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
// one roster: cat1 (TBC), managed by the account "mgr" and the role "role-mgr"; cat2 has none
jest.mock("../../../src/stores/rosterStore", () => {
    const roster = { id: "r1", categoryId: "cat1", versionId: "tbc", guildId: "g1", managers: { userIds: ["mgr"], roleIds: ["role-mgr"] }, members: {} };
    return {
        listRosters: jest.fn(() => [roster]),
        rosterForCategory: jest.fn((cat) => (cat === "cat1" ? roster : null)),
        isClosed: jest.fn(() => false),
    };
});
jest.mock("../../../src/services/events/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/events/mainVersion"),
    versionOfEvent: jest.fn(() => "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
// who may see which raid is eventVisibility's (its own tests); here every raid is visible
jest.mock("../../../src/services/signups/eventVisibility", () => ({ userSeesEvent: jest.fn(async () => true) }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }), attendanceForAccounts: () => new Map() }));
const mockMemberRoleIds = jest.fn(async () => []);
jest.mock("../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({})),
    listAllChannels: () => [],
    listGuilds: () => [],
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
}));
jest.mock("../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/services/setup/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 0 })),
    refreshLiveSetup: jest.fn(async () => ({})),
}));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const profileStore = require("../../../src/stores/raiderProfileStore");
const { emptyAccess } = require("../../../src/config/permissions");
const route = require("../../../src/web/apiRoutes/setup");
const { routerClient, status, body } = require("../../helpers/http");

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

function raid(categoryId, title) {
    const event = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId, title, startTime: START, versionId: "tbc",
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
    for (const [id, spec] of [["t1", "Warrior-Protection"], ["h1", "Priest-Holy"], ["d1", "Mage-Fire"]]) {
        signupStore.saveSignup(event.id, id, { character: id.toUpperCase(), spec, status: "signed" }, { versionId: "tbc" });
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

    it("gets 403 not_category_orga for a raid of another category, and nothing changes", async () => {
        for (const [path, payload] of [
            ["/api/raids/setup/ping-text", { event: foreign.id, text: "x" }],
            ["/api/raids/setup/propose", { event: foreign.id }],
            ["/api/raids/setup/approve", { event: foreign.id, version: 1 }],
            ["/api/raids/setup/post", { event: foreign.id }],
            ["/api/raids/setup/ping", { event: foreign.id }],
            ["/api/raids/setup/confirm", { event: foreign.id, userId: "h1", status: "confirmed" }],
            ["/api/raids/setup/extra-role", { event: foreign.id, userId: "h1", role: "healer", on: true }],
            ["/api/raids/setup/raid-add", { event: foreign.id }],
        ]) {
            const r = await api.post(path, payload);
            expect([path, status(r), code(r)]).toEqual([path, 403, "not_category_orga"]);
        }
        let r = await api.request("PUT", "/api/raids/setup", { event: foreign.id, version: 0, groups: [], bench: [] });
        expect(code(r)).toBe("not_category_orga");
        r = await api.request("PUT", "/api/raids/setup/signup", { event: foreign.id, userId: "h1", status: "absence" });
        expect(code(r)).toBe("not_category_orga");
        r = await api.get("/api/raids/setup/signup", { event: foreign.id, user: "h1" });
        expect(code(r)).toBe("not_category_orga");

        const after = eventStore.getEvent(foreign.id);
        expect(after.setup || null).toBeNull();
        expect(after.raidGroupId || "").toBe("");
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
    });
});

describe("the global orga and everybody else", () => {
    it("lets the global orga edit every raid as before, canWrite on both", async () => {
        mockUser = ORGA;
        for (const event of [own, foreign]) {
            const r = await api.post("/api/raids/setup/ping-text", { event: event.id, text: "Hallo" });
            expect(status(r)).toBe(200);
            expect(body(r).canWrite).toBe(true);
            expect(body(await api.get("/api/raids/setup", { event: event.id })).canWrite).toBe(true);
        }
        // no roster was asked for the global orga
        expect(mockMemberRoleIds).not.toHaveBeenCalled();
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
