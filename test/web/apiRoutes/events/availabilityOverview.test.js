// The orga's overview of absences through the real services/signups/absenceOverview (#1077): an entry
// without a scope concerns every server, but its name, period and reason reach the orga of a server
// only for an account that server may see. availability.test.js checks the rest of the routes with
// the overview mocked; this one proves the filter really drops the person.
let mockUser = null;
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g" }));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../../src/services/characters/profileVisibility", () => require("../../../helpers/visibilityMock").visibilityMock());
jest.mock("../../../../src/services/discord/members/serverMembers", () => ({ serverMemberIds: jest.fn() }));
jest.mock("../../../../src/services/signups/availabilityPanel", () => ({
    categoryNameFor: () => "",
    postPanel: jest.fn(),
    removePanel: jest.fn(),
    refreshPanels: jest.fn(async () => ({ edited: 0, failed: 0, unchanged: 0 })),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({})),
    getClient: () => null,
}));

const { visibleRaiderIds, raiderVisibility } = require("../../../../src/services/characters/profileVisibility");
const { serverMemberIds } = require("../../../../src/services/discord/members/serverMembers");
const store = require("../../../../src/stores/events/availabilityStore");
const eventStore = require("../../../../src/stores/events/eventStore");
const signupStore = require("../../../../src/stores/events/signupStore");
const profiles = require("../../../../src/stores/roster/raiderProfileStore");
const route = require("../../../../src/web/apiRoutes/events/availability");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { mockRes, status, json } = require("../../../helpers/http");

const MEMBER = "200000000000000030";
const FOREIGN = "200000000000000077";
const SIGNED_OFF_HERE = "200000000000000078";
const ELSEWHERE = "200000000000000079";
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: false, isOrga: true, access: { signup: { read: true, write: true }, raids: { read: true, write: true } } };
const ADMIN = { id: "1", name: "Admin", isAdmin: true, access: {} };

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const absence = (userId, comment, over = {}) => store.addEntry({ userId, kind: "absence", from: day(1), to: day(4), comment, createdBy: userId, ...over });

const handler = (path) => route.routes.find((r) => r.method === "GET" && r.path === path).handler;
async function get(path, user, query = "") {
    mockUser = user;
    const res = mockRes();
    await handler(path)({}, res, new URL(`http://x/api?${query}`));
    return res;
}
const overviewIds = async (user) => json(await get("/api/availability/overview", user)).data.raiders.map((r) => r.userId).sort();

beforeAll(() => {
    store.useFile(tempStoreFile("eh-overview-route.json"));
    eventStore.useFile(tempStoreFile("eh-overview-route-events.json"));
    signupStore.useFile(tempStoreFile("eh-overview-route-signups.json"));
    profiles.useFile(tempStoreFile("eh-overview-route-profiles.json"));
});
afterAll(() => {
    store.useFile(null);
    eventStore.useFile(null);
    signupStore.useFile(null);
    profiles.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    for (const e of store.listEntries()) store.removeEntry(e.id);
    visibleRaiderIds.mockResolvedValue(new Set([MEMBER]));
    absence(MEMBER, "Urlaub");
    absence(FOREIGN, "Zahnarzt");
    absence(SIGNED_OFF_HERE, "Umzug", { scope: [{ guildId: "g", categoryIds: [] }] });
    absence(ELSEWHERE, "Klausur", { scope: [{ guildId: "A", categoryIds: [] }] });
});

describe("GET /api/availability/overview (#1077)", () => {
    it("leaves out a raider only of another server with an entry without a scope, name and reason alike", async () => {
        const res = await get("/api/availability/overview", ORGA);
        expect(status(res)).toBe(200);
        expect(json(res).data.raiders.map((r) => r.userId).sort()).toEqual([MEMBER, SIGNED_OFF_HERE].sort());
        expect(JSON.stringify(json(res).data)).not.toContain(FOREIGN);
        expect(JSON.stringify(json(res).data)).not.toContain("Zahnarzt");
    });

    it("shows that raider once this server may see them", async () => {
        visibleRaiderIds.mockResolvedValue(new Set([MEMBER, FOREIGN]));
        expect(await overviewIds(ORGA)).toEqual([MEMBER, FOREIGN, SIGNED_OFF_HERE].sort());
    });

    it("keeps only signed-off entries of this server while the member list cannot be read", async () => {
        raiderVisibility.mockResolvedValueOnce({ ids: new Set(), membersKnown: false });
        expect(await overviewIds(ORGA)).toEqual([SIGNED_OFF_HERE]);
    });

    it("shows a full admin every entry of this server, without a member list", async () => {
        expect(await overviewIds(ADMIN)).toEqual([MEMBER, FOREIGN, SIGNED_OFF_HERE].sort());
        expect(visibleRaiderIds).not.toHaveBeenCalled();
    });

    it("stays stricter for the rank alone: no entry without a scope, not even of a member", async () => {
        const RANK = { ...ORGA, id: "200000000000000020", isServerAdmin: true };
        const withoutRank = jest.spyOn(require("../../../../src/web/http/auth"), "getUserWithoutRank").mockReturnValue({ id: RANK.id, isAdmin: false, access: {} });
        try {
            expect(await overviewIds(RANK)).toEqual([SIGNED_OFF_HERE]);
        } finally {
            withoutRank.mockRestore();
        }
    });
});

describe("GET /api/availability/overview/raider (#1077)", () => {
    const PATH = "/api/availability/overview/raider";

    it("refuses a raider out of reach and names no entry", async () => {
        const res = await get(PATH, ORGA, `userId=${FOREIGN}`);
        expect([status(res), json(res).error.code]).toEqual([403, "other_server"]);
        expect(JSON.stringify(json(res))).not.toContain("Zahnarzt");
    });

    it("says 503 when only the member list is missing", async () => {
        raiderVisibility.mockResolvedValueOnce({ ids: new Set(), membersKnown: false });
        const res = await get(PATH, ORGA, `userId=${MEMBER}`);
        expect([status(res), json(res).error.code]).toEqual([503, "members_unavailable"]);
    });

    it("shows a raider in reach with their entry without a scope", async () => {
        const res = await get(PATH, ORGA, `userId=${MEMBER}`);
        expect(status(res)).toBe(200);
        expect(json(res).data.entries).toHaveLength(1);
    });

    it("gives a full admin the raider of another server", async () => {
        const res = await get(PATH, ADMIN, `userId=${FOREIGN}`);
        expect(status(res)).toBe(200);
        expect(json(res).data.entries).toHaveLength(1);
        expect(serverMemberIds).not.toHaveBeenCalled();
    });
});
