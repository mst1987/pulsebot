// Kategorie-Orga (#724): globale Orga oder Manager des Rosters der Kategorie - je Version.
// Stores and the roster lookup are mocked; the Discord roles come through `memberRoleIds`.
const ROSTERS = {
    "cat1:tbc": { id: "r1", categoryId: "cat1", versionId: "tbc", guildId: "g1", managers: { userIds: ["mgr"], roleIds: ["role-mgr"] } },
    "cat1:forever": { id: "r1f", categoryId: "cat1", versionId: "forever", guildId: "g1", managers: { userIds: ["fmgr"], roleIds: [] } },
    "cat2:tbc": { id: "r2", categoryId: "cat2", versionId: "tbc", guildId: "g2", managers: { userIds: ["other", "dual"], roleIds: ["role-2"] } },
    // cat3 switched to Forever: its TBC roster is closed (#739)
    "cat3:tbc": { id: "r3", categoryId: "cat3", versionId: "tbc", guildId: "g1", closedAt: "2026-10-01T00:00:00.000Z", managers: { userIds: ["dual"], roleIds: [] } },
    "cat3:forever": { id: "r3f", categoryId: "cat3", versionId: "forever", guildId: "g1", managers: { userIds: ["f3"], roleIds: [] } },
};
const mockCurrentVersion = { cat1: "tbc", cat2: "tbc", cat3: "forever" };
jest.mock("../../../src/stores/rosterStore", () => ({ listRosters: jest.fn(() => Object.values(ROSTERS)) }));
jest.mock("../../../src/services/roster/categoryRoster", () => ({
    currentRoster: jest.fn((cat) => ROSTERS[`${cat}:${mockCurrentVersion[cat]}`] || null),
    rosterOfEvent: jest.fn((ev) => ROSTERS[`${ev.categoryId}:${ev.versionId || mockCurrentVersion[ev.categoryId]}`] || null),
    isCurrentRoster: jest.fn((r) => !!r && !r.closedAt && r.versionId === mockCurrentVersion[r.categoryId]),
}));
const mockEvents = {};
jest.mock("../../../src/stores/eventStore", () => ({
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
}));
const mockSnapshots = {};
jest.mock("../../../src/stores/raidEventStore", () => ({ getRaidEvent: jest.fn((id) => mockSnapshots[id] || null) }));
jest.mock("../../../src/services/discord/userAccess", () => ({ resolveAccess: jest.fn(async () => ({ isAdmin: false, access: {} })) }));
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn(async () => null) }));

const orga = require("../../../src/services/roster/categoryOrga");
const { resolveAccess } = require("../../../src/services/discord/userAccess");
const categoryRoster = require("../../../src/services/roster/categoryRoster");

const admin = { id: "a", isAdmin: true, access: {} };
const globalOrga = { id: "o", isAdmin: false, isOrga: true, access: {} };
const raider = (id) => ({ id, isAdmin: false, access: {} });
const roles = (byUser) => jest.fn(async (guildId, userId) => byUser[`${guildId}:${userId}`] || []);

beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    for (const k of Object.keys(mockSnapshots)) delete mockSnapshots[k];
    mockCurrentVersion.cat1 = "tbc";
});

describe("services/roster/categoryOrga isCategoryOrga", () => {
    it("lets a full admin and the global orga in everywhere, also without a roster", async () => {
        const memberRoleIds = roles({});
        for (const user of [admin, globalOrga]) {
            expect(await orga.isCategoryOrga(user, "cat1", { memberRoleIds })).toBe(true);
            expect(await orga.isCategoryOrga(user, "no-roster", { memberRoleIds })).toBe(true);
        }
        expect(memberRoleIds).not.toHaveBeenCalled();
    });

    it("lets a manager in by account and by role - only in their own category", async () => {
        const memberRoleIds = roles({ "g1:x": ["role-mgr"] });
        expect(await orga.isCategoryOrga(raider("mgr"), "cat1", { memberRoleIds })).toBe(true);
        expect(await orga.isCategoryOrga(raider("x"), "cat1", { memberRoleIds })).toBe(true);
        expect(await orga.isCategoryOrga(raider("x"), "cat2", { memberRoleIds })).toBe(false);
        expect(await orga.isCategoryOrga(raider("mgr"), "cat2", { memberRoleIds })).toBe(false);
        expect(await orga.isCategoryOrga(raider("nobody"), "cat1", { memberRoleIds })).toBe(false);
    });

    it("gives a category without a roster no category orga", async () => {
        expect(await orga.isCategoryOrga(raider("mgr"), "no-roster", { memberRoleIds: roles({}) })).toBe(false);
        expect(await orga.isCategoryOrga(raider("mgr"), "")).toBe(false);
        expect(await orga.isCategoryOrga(null, "cat1")).toBe(false);
    });

    it("asks the roster of the version the category plays now", async () => {
        mockCurrentVersion.cat1 = "forever";
        expect(await orga.isCategoryOrga(raider("mgr"), "cat1", { memberRoleIds: roles({}) })).toBe(false);
        expect(await orga.isCategoryOrga(raider("fmgr"), "cat1", { memberRoleIds: roles({}) })).toBe(true);
    });

    it("counts a failing or hanging role lookup as no role", async () => {
        expect(await orga.isCategoryOrga(raider("x"), "cat1", { memberRoleIds: async () => { throw new Error("offline"); } })).toBe(false);
        const hanging = orga.cachedRoleLookup(orga.createCache(), () => new Promise(() => {}), 10);
        expect(await hanging("g1", "x")).toBeNull();
    });

    it("by Discord id: resolves the account's rights first (the Orga-Zentrale)", async () => {
        resolveAccess.mockResolvedValueOnce({ isAdmin: false, isOrga: true, access: {} });
        expect(await orga.isCategoryOrgaById("u1", "cat2")).toBe(true);
        expect(await orga.isCategoryOrgaById("mgr", "cat1")).toBe(true);
        expect(await orga.isCategoryOrgaById("u1", "cat1")).toBe(false);
        expect(await orga.isCategoryOrgaById("", "cat1")).toBe(false);
    });
});

describe("services/roster/categoryOrga per request", () => {
    it("reads the Discord roles once per server and user for one request", async () => {
        const memberRoleIds = roles({ "g1:x": ["role-mgr"] });
        const req = {};
        const cache = orga.requestCache(req);
        expect(orga.requestCache(req)).toBe(cache);
        expect(orga.requestCache({})).not.toBe(cache);
        await orga.isCategoryOrga(raider("x"), "cat1", { cache, memberRoleIds });
        mockSnapshots.rh1 = { categoryId: "cat1" };
        expect(await orga.canOrgaEvent(raider("x"), "rh1", { cache, memberRoleIds })).toBe(true);
        await orga.orgaCategoryIds(raider("x"), { cache, memberRoleIds });
        expect(memberRoleIds.mock.calls.filter(([g]) => g === "g1")).toHaveLength(1);
        expect(typeof orga.requestCache(null).roles.get).toBe("function");
    });
});

describe("services/roster/categoryOrga orgaCategoryIds / isAnyCategoryManager", () => {
    it("names the categories someone manages; the global orga gets every category with a roster", async () => {
        const memberRoleIds = roles({ "g2:x": ["role-2"] });
        expect(await orga.orgaCategoryIds(raider("mgr"), { memberRoleIds })).toEqual(["cat1"]);
        expect(await orga.orgaCategoryIds(raider("x"), { memberRoleIds })).toEqual(["cat2"]);
        expect(await orga.orgaCategoryIds(raider("nobody"), { memberRoleIds })).toEqual([]);
        expect(await orga.orgaCategoryIds(globalOrga, { memberRoleIds })).toEqual(["cat1", "cat2", "cat3"]);
        expect(await orga.orgaCategoryIds(null)).toEqual([]);
    });

    it("managerOnly (#728): the global orga gets only the categories whose roster they manage", async () => {
        const memberRoleIds = roles({});
        expect(await orga.orgaCategoryIds(globalOrga, { memberRoleIds, managerOnly: true })).toEqual([]);
        expect(await orga.orgaCategoryIds({ ...globalOrga, id: "mgr" }, { memberRoleIds, managerOnly: true })).toEqual(["cat1"]);
        expect(await orga.orgaCategoryIds(raider("mgr"), { memberRoleIds, managerOnly: true })).toEqual(["cat1"]);
    });

    it("tells whether someone manages any current roster", async () => {
        const memberRoleIds = roles({});
        expect(await orga.isAnyCategoryManager(raider("mgr"), { memberRoleIds })).toBe(true);
        expect(await orga.isAnyCategoryManager(raider("nobody"), { memberRoleIds })).toBe(false);
        // the manager of a roster of a version the category does not play now is no orga today
        expect(await orga.isAnyCategoryManager(raider("fmgr"), { memberRoleIds })).toBe(false);
        expect(await orga.isAnyCategoryManager(null)).toBe(false);
    });
});

describe("services/roster/categoryOrga canOrgaEvent", () => {
    it("lets the global orga in for any raid, without looking it up", async () => {
        expect(await orga.canOrgaEvent(admin, "unknown")).toBe(true);
        expect(await orga.canOrgaEvent(globalOrga, { id: "x" })).toBe(true);
        expect(await orga.canOrgaEvent(null, "eh-1")).toBe(false);
    });

    it("own event: its stored category and version decide", async () => {
        mockEvents["eh-1"] = { id: "eh-1", categoryId: "cat1", versionId: "tbc" };
        mockEvents["eh-2"] = { id: "eh-2", categoryId: "cat1", versionId: "forever" };
        const memberRoleIds = roles({});
        expect(await orga.canOrgaEvent(raider("mgr"), "eh-1", { memberRoleIds })).toBe(true);
        // a raid of another version belongs to that version's roster
        expect(await orga.canOrgaEvent(raider("mgr"), "eh-2", { memberRoleIds })).toBe(false);
        // ... and that roster gives the right only once the category plays that version (#725 review):
        // cat1 still plays TBC, its Forever roster is prepared but not current yet
        expect(await orga.canOrgaEvent(raider("fmgr"), "eh-2", { memberRoleIds })).toBe(false);
        expect(categoryRoster.rosterOfEvent).toHaveBeenLastCalledWith(mockEvents["eh-2"], { config: undefined });
        mockCurrentVersion.cat1 = "forever";
        expect(await orga.canOrgaEvent(raider("fmgr"), "eh-2", { memberRoleIds })).toBe(true);
        // the TBC roster is not current any more either
        expect(await orga.canOrgaEvent(raider("mgr"), "eh-1", { memberRoleIds })).toBe(false);
        mockCurrentVersion.cat1 = "tbc";
        // a row cannot pretend another category: the stored event wins
        expect(await orga.canOrgaEvent(raider("other"), { id: "eh-1", categoryId: "cat2" }, { memberRoleIds })).toBe(false);
        expect(await orga.canOrgaEvent(raider("mgr"), "eh-missing", { memberRoleIds })).toBe(false);
        // a row's version does not count either: eh-1 stays a TBC raid
        expect(await orga.canOrgaEvent(raider("fmgr"), { id: "eh-1", versionId: "forever" }, { memberRoleIds })).toBe(false);
        expect(await orga.canOrgaEvent(raider("mgr"), { id: "eh-1", versionId: "forever" }, { memberRoleIds })).toBe(true);
        // an unknown own id is no raid, whatever the row claims
        expect(await orga.canOrgaEvent(raider("mgr"), { id: "eh-missing", categoryId: "cat1" }, { memberRoleIds })).toBe(false);
    });

    it("a row without an id (a new event in a category) counts by its category, in the version played now", async () => {
        const memberRoleIds = roles({});
        expect(await orga.canOrgaEvent(raider("mgr"), { categoryId: "cat1" }, { memberRoleIds })).toBe(true);
        expect(await orga.canOrgaEvent(raider("fmgr"), { categoryId: "cat1", versionId: "forever" }, { memberRoleIds })).toBe(false);
        expect(await orga.canOrgaEvent(raider("mgr"), { categoryId: "cat2" }, { memberRoleIds })).toBe(false);
        expect(await orga.canOrgaEvent(raider("mgr"), {}, { memberRoleIds })).toBe(false);
    });

    it("a closed roster gives no right - not even to who manages a current roster elsewhere (#739)", async () => {
        mockEvents["eh-old"] = { id: "eh-old", categoryId: "cat3", versionId: "tbc" };
        mockEvents["eh-b"] = { id: "eh-b", categoryId: "cat2", versionId: "tbc" };
        const memberRoleIds = roles({});
        expect(await orga.isAnyCategoryManager(raider("dual"), { memberRoleIds })).toBe(true);
        expect(await orga.canOrgaEvent(raider("dual"), "eh-old", { memberRoleIds })).toBe(false);
        expect(await orga.canOrgaEvent(raider("dual"), "eh-b", { memberRoleIds })).toBe(true);
        expect(await orga.orgaCategoryIds(raider("dual"), { memberRoleIds })).toEqual(["cat2"]);
        expect(await orga.orgaCategoryIds(globalOrga, { memberRoleIds })).toEqual(["cat1", "cat2", "cat3"]);
    });

    it("managerOnly: the global orga counts only through a roster", async () => {
        mockEvents["eh-1"] = { id: "eh-1", categoryId: "cat1", versionId: "tbc" };
        mockEvents["eh-b"] = { id: "eh-b", categoryId: "cat2", versionId: "tbc" };
        const orgaManager = { ...globalOrga, id: "mgr" };
        const memberRoleIds = roles({});
        expect(await orga.canOrgaEvent(orgaManager, "eh-1", { memberRoleIds, managerOnly: true })).toBe(true);
        expect(await orga.canOrgaEvent(orgaManager, "eh-b", { memberRoleIds, managerOnly: true })).toBe(false);
        expect(await orga.canOrgaEvent(orgaManager, "eh-b", { memberRoleIds })).toBe(true);
    });

    it("Raid-Helper event: the snapshot, else the event groups - never the row's claim", async () => {
        const memberRoleIds = roles({});
        // unknown to the server: the row's category does not count
        expect(await orga.canOrgaEvent(raider("mgr"), { id: "rh1", categoryId: "cat1" }, { memberRoleIds })).toBe(false);
        mockSnapshots.rh2 = { categoryId: "cat2", guildId: "g2" };
        expect(await orga.canOrgaEvent(raider("other"), "rh2", { memberRoleIds })).toBe(true);
        expect(await orga.canOrgaEvent(raider("mgr"), "rh2", { memberRoleIds })).toBe(false);
        // a row naming another category for a snapshot event
        expect(await orga.canOrgaEvent(raider("mgr"), { id: "rh2", categoryId: "cat1" }, { memberRoleIds })).toBe(false);
        const loadGroups = jest.fn(async () => ({ groups: [{ categoryId: "cat1", events: [{ id: "rh3" }] }] }));
        expect(await orga.canOrgaEvent(raider("mgr"), "rh3", { memberRoleIds, loadGroups })).toBe(true);
        expect(await orga.canOrgaEvent(raider("mgr"), "rh4", { memberRoleIds, loadGroups })).toBe(false);
        // unknown without the groups, or when they fail: no category orga
        expect(await orga.canOrgaEvent(raider("mgr"), "rh3", { memberRoleIds })).toBe(false);
        expect(await orga.canOrgaEvent(raider("mgr"), "rh3", { memberRoleIds, loadGroups: async () => { throw new Error("down"); } })).toBe(false);
        expect(await orga.canOrgaEvent(raider("mgr"), "", { memberRoleIds })).toBe(false);
    });
});

describe("services/roster/categoryOrga managesRoster / isOrgaOfRoster", () => {
    it("is the manager rule without the global orga; isOrgaOfRoster adds it", async () => {
        const roster = ROSTERS["cat1:tbc"];
        expect(await orga.managesRoster(globalOrga, roster, { memberRoleIds: roles({}) })).toBe(false);
        expect(await orga.isOrgaOfRoster(globalOrga, roster)).toBe(true);
        expect(await orga.isOrgaOfRoster(raider("mgr"), roster, { memberRoleIds: roles({}) })).toBe(true);
        expect(await orga.managesRoster(admin, null)).toBe(true);
        expect(await orga.managesRoster(raider("mgr"), null)).toBe(false);
        expect(await orga.managesRoster(null, roster)).toBe(false);
        expect(await orga.isOrgaOfRoster(null, roster)).toBe(false);
    });
});
