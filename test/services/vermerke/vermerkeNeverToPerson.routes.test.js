// Vermerke never reach the person (docs/vermerke.md, #979/#981) - the setup editor's answer.
//
// GET /api/raids/setup carries the short form (`vermerke`) and the shadowban hint (`shadowbanInPool`)
// for the orga only: a raider, the noted raider himself and an admin in "Ansicht als Raider" get
// neither, and never the marker text. The raid detail's answer is checked in
// test/web/events/raidDetailView.test.js (#981). Kept apart from vermerkeNeverToPerson.test.js since
// the setup route needs the event, signup and profile stores and a few service mocks.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "A"),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "A"), pickActiveGuild: jest.fn(async () => "A") }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../src/stores/rosterStore", () => ({ listRosters: jest.fn(() => []), rosterForCategory: jest.fn(() => null), isClosed: jest.fn(() => false) }));
jest.mock("../../../src/services/events/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/events/mainVersion"),
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
jest.mock("../../../src/services/signups/eventVisibility", () => ({ userSeesEvent: jest.fn(async () => true) }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }), attendanceForAccounts: () => new Map() }));
jest.mock("../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({})),
    avatarUrlFor: () => "",
    listAllChannels: () => [],
    listGuilds: () => [],
    memberRoleIds: jest.fn(async () => []),
}));
jest.mock("../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/services/setup/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 0 })),
    refreshLiveSetup: jest.fn(async () => ({})),
}));

const { tempStoreFile } = require("../../helpers/tempStore");
const { routerClient, status, body } = require("../../helpers/http");
const notes = require("../../../src/stores/userNotesStore");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const profileStore = require("../../../src/stores/raiderProfileStore");
const { emptyAccess } = require("../../../src/config/permissions");
const { effectiveUser } = require("../../../src/web/http/viewAs");
const route = require("../../../src/web/apiRoutes/events/setup");

const api = routerClient(route);
const MARKER = "VERMERK-MARKER-7f3a";
const U = "111111111111111111";
const RAIDER_ROLE = "444444444444444444";
const START = Math.floor(Date.now() / 1000) + 7 * 86400;

const raiderAccess = () => ({ ...emptyAccess(), raids: { read: true, write: false }, signup: { read: true, write: true } });
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true } } };
const raider = { id: U, name: "Zed", isAdmin: false, access: raiderAccess() };
const other = { id: "222", name: "Bob", isAdmin: false, access: raiderAccess() };
const config = { baseAccess: { signup: "write", raids: "read" }, rolePermissions: {}, adminRoleIds: [], orgaRoleIds: [] };
const viewing = effectiveUser({ id: "1", name: "Admin", isAdmin: true, access: emptyAccess(), viewAs: { roleIds: [RAIDER_ROLE], at: Date.now() } }, config);

let raid;

beforeEach(() => {
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    profileStore.useFile(tempStoreFile("profiles.json"));
    notes.useFile(tempStoreFile("user-notes.json"));
    raid = eventStore.createEvent({
        guildId: "A", channelId: "c1", categoryId: "cat1", title: "Karazhan", startTime: START, versionId: "tbc",
        size: 10, composition: { tank: 1, healer: 1, melee: 0, ranged: 0 },
    }).event;
    for (const [id, character, spec] of [["t1", "Tank", "Warrior-Protection"], ["h1", "Heal", "Priest-Holy"], [U, "Zed", "Mage-Fire"]]) {
        signupStore.saveSignup(raid.id, id, { character, spec, status: "signed" }, { versionId: "tbc" });
    }
    notes.addEntry("A", U, { level: "shadowban", reason: "behavior", text: MARKER, shared: true }, { by: "1", byName: MARKER, name: "Zed" });
});
afterAll(() => {
    notes.useFile(null);
    eventStore.useFile(null);
    signupStore.useFile(null);
    profileStore.useFile(null);
});

describe("the setup editor's answer (#981)", () => {
    it("names the shadowbanned raider to the orga, as the short form, without the text", async () => {
        mockUser = ORGA;
        const r = await api.post("/api/raids/setup/propose", { event: raid.id });
        expect(status(r)).toBe(200);
        expect(body(r).vermerke[U].level).toBe("shadowban");
        expect(body(r).shadowbanInPool).toEqual([{ userId: U, name: "Zed" }]);
        expect(JSON.stringify(body(r))).not.toContain(MARKER);
    });

    it("'Ansicht als Raider' is no admin and no orga", () => {
        expect(viewing.isAdmin).toBe(false);
        expect(viewing.viewAs).toBeTruthy();
    });

    it.each([["the noted raider", raider], ["another raider", other], ["an admin in 'Ansicht als Raider'", viewing]])("%s never gets the short form, the hint or the marker", async (_label, user) => {
        mockUser = ORGA;
        expect(status(await api.post("/api/raids/setup/propose", { event: raid.id }))).toBe(200);
        mockUser = user;
        const r = await api.get("/api/raids/setup", { event: raid.id });
        const text = JSON.stringify(body(r));
        expect(body(r)).not.toHaveProperty("vermerke");
        expect(body(r)).not.toHaveProperty("shadowbanInPool");
        expect(text).not.toContain(MARKER);
        expect(text).not.toMatch(/shadowban/);
    });
});
