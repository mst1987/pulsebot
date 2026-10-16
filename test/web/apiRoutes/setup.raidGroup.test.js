// The raid group routes of the setup editor (#811), through the real router:
// POST /api/raids/setup/raid-add ("Weiteren Raid hinzufügen"), /move-raid (a
// raider into another raid of the group) and /raid-remove (dissolve a further
// raid) — raids write, real event and signup stores on scratch files.
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
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: () => [], firstCharacter: () => null, getProfile: () => null }));
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: () => null }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }), attendanceForAccounts: () => new Map() }));
jest.mock("../../../src/services/discord/discord", () => ({ resolveUserNames: jest.fn(async () => ({})), listAllChannels: () => [], listGuilds: () => [] }));
jest.mock("../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/services/setup/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 0 })),
    refreshLiveSetup: jest.fn(async () => ({})),
}));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const { refreshEventMessage } = require("../../../src/services/events/eventMessage");
const route = require("../../../src/web/apiRoutes/setup");
const { checkAccess } = require("../../../src/web/http/apiAccess");
const { routerClient, status, body } = require("../../helpers/http");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const api = routerClient(route);

let primary;

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = ORGA;
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    primary = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId: "cat", title: "Zul'Aman", startTime: START, versionId: "tbc",
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
    eventStore.setEventMessage(primary.id, { channelId: "c1", messageId: "m1" });
    for (const [id, spec] of [["t1", "Warrior-Protection"], ["h1", "Priest-Holy"], ["d1", "Mage-Fire"]]) {
        signupStore.saveSignup(primary.id, id, { character: id.toUpperCase(), spec, status: "signed" }, { versionId: "tbc" });
    }
});

describe("access", () => {
    it("is raids write", () => {
        for (const path of ["/api/raids/setup/raid-add", "/api/raids/setup/raid-remove", "/api/raids/setup/move-raid"]) {
            expect(checkAccess(path, "POST", READER)).toMatchObject({ status: 403 });
            expect(checkAccess(path, "POST", ORGA)).toBeNull();
        }
    });
});

describe("POST /api/raids/setup/raid-add", () => {
    it("creates the further raid, answers its id and the group, and redraws the first raid's message (its counts)", async () => {
        const r = await api.post("/api/raids/setup/raid-add", { event: primary.id, title: "ZA Gruppe B" });
        expect(status(r)).toBe(200);
        const out = body(r);
        expect(out.title).toBe("ZA Gruppe B");
        expect(out.raidGroup).toMatchObject({ count: 2, places: 20 });
        expect(eventStore.getEvent(out.event)).toMatchObject({ raidGroupId: primary.id, raidGroupIndex: 2 });
        expect(refreshEventMessage).toHaveBeenCalledWith(primary.id);
    });

    it("refuses a Raid-Helper id", async () => {
        expect(status(await api.post("/api/raids/setup/raid-add", { event: "12345" }))).toBe(409);
    });
});

describe("the editor of a further raid", () => {
    it("answers the group (tabs) and the shared pool; a move goes into the other raid", async () => {
        const sibling = body(await api.post("/api/raids/setup/raid-add", { event: primary.id })).event;
        const view = body(await api.get("/api/raids/setup", { event: sibling }));
        expect(view.raidGroup.raids.map((x) => x.title)).toEqual(["Zul'Aman", "Zul'Aman 2"]);
        expect(view.setup.pool.map((p) => p.userId).sort()).toEqual(["d1", "h1", "t1"]);

        const moved = await api.post("/api/raids/setup/move-raid", { event: primary.id, target: sibling, userId: "h1" });
        expect(status(moved)).toBe(200);
        expect(body(moved).message).toMatch(/H1 → Zul'Aman 2/);
        expect(body(moved).setup.pool.map((p) => p.userId).sort()).toEqual(["d1", "t1"]);
        expect(eventStore.getEvent(sibling).setup.groups[0].slots.map((s) => s.userId)).toEqual(["h1"]);

        // the same raider into the first raid as well: one seat per person
        const twice = await api.request("PUT", "/api/raids/setup", { event: primary.id, version: 0, groups: [{ index: 1, slots: [{ userId: "h1", spec: "Priest-Holy" }] }], bench: [] });
        expect(status(twice)).toBe(409);
        expect(body(twice).error.code).toBe("taken");
    });

    it("dissolves a further raid: its raiders go back into the pool", async () => {
        const sibling = body(await api.post("/api/raids/setup/raid-add", { event: primary.id })).event;
        await api.post("/api/raids/setup/move-raid", { event: primary.id, target: sibling, userId: "t1" });
        const r = await api.post("/api/raids/setup/raid-remove", { event: sibling });
        expect(status(r)).toBe(200);
        expect(body(r)).toMatchObject({ event: primary.id, raidGroup: null });
        expect(body(r).message).toMatch(/1 zurück/);
        expect(eventStore.getEvent(sibling)).toBeNull();
        const view = body(await api.get("/api/raids/setup", { event: primary.id }));
        expect(view.setup.pool.map((p) => p.userId).sort()).toEqual(["d1", "h1", "t1"]);
        // the first raid carries the signup: never dissolved
        expect(status(await api.post("/api/raids/setup/raid-remove", { event: primary.id }))).toBe(409);
    });
});
