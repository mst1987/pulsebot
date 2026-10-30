// The orga's exemption in the own signup (#727, epic #723): `byOrga` in PUT /api/signups and
// POST /api/signups/bulk (a closed signup, the deadline and the required message do not bind the orga)
// is per raid now - the global orga with `raids` write for every raid, a manager of the current roster of
// a category for that category's raids only (web/events/raidOrgaAccess.js, the rule of the `orgaScoped`
// gate). A raider role with `raids` write but no orga rank is bound like every raider. Real event,
// signup and profile stores on scratch files; the rule's own tests: test/services/roster/categoryOrga.test.js.
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
jest.mock("../../../../src/stores/settingsStore", () => ({ ...jest.requireActual("../../../../src/stores/settingsStore"), getConfig: () => ({}) }));
// cat1's TBC roster is managed by "mgr"; cat2 has no roster
jest.mock("../../../../src/stores/rosterStore", () => {
    const rosters = { "cat1:tbc": { id: "r1", categoryId: "cat1", versionId: "tbc", guildId: "g1", managers: { userIds: ["mgr"], roleIds: [] }, roleIds: [], members: {} } };
    return {
        listRosters: jest.fn(() => Object.values(rosters)),
        rosterForCategory: jest.fn((cat, version) => rosters[`${cat}:${version}`] || null),
        isClosed: jest.fn(() => false),
    };
});
jest.mock("../../../../src/services/events/mainVersion", () => ({
    ...jest.requireActual("../../../../src/services/events/mainVersion"),
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../../src/services/discord/discord"),
    memberRoleIds: jest.fn(async () => []),
    resolveUserNames: jest.fn(async () => ({})),
}));
// the note to the orga's channel is Discord's: not posted here
jest.mock("../../../../src/services/signups/signupNotes", () => ({
    ...jest.requireActual("../../../../src/services/signups/signupNotes"),
    postSignupNote: jest.fn(async () => ({ posted: false })),
}));

const { tempStoreFile } = require("../../../helpers/tempStore");
const eventStore = require("../../../../src/stores/eventStore");
const signupStore = require("../../../../src/stores/signupStore");
const profiles = require("../../../../src/stores/raiderProfileStore");
const { emptyAccess } = require("../../../../src/config/permissions");
const route = require("../../../../src/web/apiRoutes/events/signups");
const { routerClient, status, body } = require("../../../helpers/http");

const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const api = routerClient(route);

const raiderAccess = () => ({ ...emptyAccess(), raids: { read: true, write: false }, signup: { read: true, write: true } });
const MANAGER = { id: "mgr", name: "Manager", isAdmin: false, access: raiderAccess() };
const RAIDER = { id: "raider", name: "Raider", isAdmin: false, access: raiderAccess() };
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true }, signup: { read: true, write: true } } };
const WRITER = { id: "rw", name: "Schreiber", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: true }, signup: { read: true, write: true } } };

let own;
let foreign;

function closedRaid(categoryId, title) {
    const event = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId, title, startTime: START, versionId: "tbc",
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
    return eventStore.setEventState(event.id, { signupsClosed: true });
}

beforeEach(() => {
    jest.clearAllMocks();
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
    for (const u of [MANAGER, RAIDER, ORGA, WRITER]) {
        profiles.addCharacter(u.id, { name: `Char${u.id}`, className: "Mage", specs: ["Mage-Fire"] }, { name: u.name });
    }
    own = closedRaid("cat1", "Karazhan");
    foreign = closedRaid("cat2", "Gruul");
});

const code = (r) => (body(r).error || {}).code;
const signUp = (user, event) => {
    mockUser = user;
    return api.request("PUT", "/api/signups", { eventId: event.id, character: `Char${user.id}`, spec: "Mage-Fire", status: "signed" });
};
const bulk = (user, events) => {
    mockUser = user;
    return api.post("/api/signups/bulk", { eventIds: events.map((e) => e.id), characters: [{ character: `Char${user.id}`, spec: "Mage-Fire" }], status: "signed" });
};

describe("PUT /api/signups: byOrga per raid", () => {
    it("lets the orga of the raid's category sign up into a closed signup of their category only", async () => {
        expect(status(await signUp(MANAGER, own))).toBe(200);
        expect(signupStore.getSignup(own.id, "mgr")).toBeTruthy();
        const r = await signUp(MANAGER, foreign);
        expect(status(r)).toBe(409);
        expect(code(r)).toBe("closed");
        expect(signupStore.getSignup(foreign.id, "mgr")).toBeNull();
    });

    it("exempts the global orga in every category", async () => {
        expect(status(await signUp(ORGA, own))).toBe(200);
        expect(status(await signUp(ORGA, foreign))).toBe(200);
    });

    it("binds a raider role with `raids` write but no orga rank, and a raider", async () => {
        for (const user of [WRITER, RAIDER]) {
            for (const event of [own, foreign]) {
                const r = await signUp(user, event);
                expect([user.id, event.title, status(r), code(r)]).toEqual([user.id, event.title, 409, "closed"]);
            }
        }
    });
});

describe("POST /api/signups/bulk: byOrga per raid", () => {
    it("exempts the orga of a category in that category's raid and not in the other", async () => {
        const r = await bulk(MANAGER, [own, foreign]);
        expect(status(r)).toBe(200);
        const byId = Object.fromEntries(body(r).results.map((x) => [x.eventId, x]));
        expect(byId[own.id]).toMatchObject({ ok: true });
        expect(byId[foreign.id]).toMatchObject({ ok: false, code: "closed" });
    });

    it("exempts the global orga in both, a raider role with `raids` write in neither", async () => {
        expect(body(await bulk(ORGA, [own, foreign])).results.map((x) => x.ok)).toEqual([true, true]);
        expect(body(await bulk(WRITER, [own, foreign])).results.map((x) => x.ok)).toEqual([false, false]);
    });
});
