// The game must see exactly what the page shows: the council page
// (GET /api/lootcouncil with the stored view's filters) and the sync tool's
// GET /api/ingest/council?v=2 go through the real councilRoster() here, with
// only the data sources mocked, and must answer with the same raiders and the
// same need numbers. Raiders the council set aside appear in neither.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockExcludedKeys = jest.fn(() => new Set());
const mockViews = {};
const mockRosters = {};
const mockProfiles = jest.fn(() => []);

jest.mock("../../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({
    gearByCharacter: () => new Map(),
    gearFor: () => null,
    charKey: (n) => String(n).toLowerCase(),
}));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: () => ({}) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: () => ({}) }));
jest.mock("../../../src/stores/councilStore", () => {
    const actual = jest.requireActual("../../../src/stores/councilStore");
    return {
        excludedKeys: (...a) => mockExcludedKeys(...a),
        plannedRoles: () => new Map(),
        listExcluded: () => ({}),
        listViews: () => ({}),
        VIEW_DEFAULTS: actual.VIEW_DEFAULTS,
        viewFor: (id) => (mockViews[id] ? { ...mockViews[id], stored: true } : { ...actual.VIEW_DEFAULTS, stored: false }),
    };
});
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: () => [] }));
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: () => [], getEvent: () => null, isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null, getReportRoster: () => null }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: (...a) => mockProfiles(...a) }));
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: (id) => mockRosters[id] || null }));
jest.mock("../../../src/stores/logGearStore", () => ({ loadLogGear: jest.fn(), clearLogGear: jest.fn(), recentLogs: () => [] }));
jest.mock("../../../src/stores/simStore", () => ({ startCouncilSim: jest.fn(), getJob: jest.fn() }));
jest.mock("../../../src/services/loot/armoryGear", () => ({
    primeArmoryGear: jest.fn(async () => ({ answered: 0 })),
    clearArmoryFor: jest.fn(),
}));
jest.mock("../../../src/stores/raidTemplateStore", () => ({ getRaidTemplate: () => null }));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: () => [{ id: "c1", name: "Mittwoch" }, { id: "c2", name: "Sonntag" }],
}));
const mockConfig = {
    categoryIds: ["c1", "c2", "c3"],
    categoryLootSystem: { c1: "lootcouncil", c3: "softres" },
    categoryLootTool: { c2: "rclc" },
};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    verifyToken: () => ({ id: "t1", name: "PC" }),
    touchToken: jest.fn(),
    bearerFrom: () => "ehl_good",
}));

const { getLootCouncil } = require("../../../src/web/apiRoutes/lootCouncil");
const { ingestCouncil } = require("../../../src/web/apiRoutes/ingest");
const { mockRes, body } = require("../../helpers/http");
const { lootRow, DAY, now } = require("../../helpers/lootCouncil");

async function page(query) {
    const res = mockRes();
    await getLootCouncil({ headers: {} }, res, new URL(`http://localhost/api/lootcouncil?${query}`));
    return body(res);
}

async function ingest(query) {
    const res = mockRes();
    await ingestCouncil({ headers: { authorization: "Bearer ehl_good" } }, res, new URL(`http://localhost/api/ingest/council?${query}`));
    return body(res);
}

const slim = (rows) => rows.map((r) => ({ key: r.key, character: r.character, need: Math.round(r.needScore * 100), lootCount: r.lootCount }));

beforeEach(() => {
    for (const k of Object.keys(mockViews)) delete mockViews[k];
    for (const k of Object.keys(mockRosters)) delete mockRosters[k];
    mockProfiles.mockReturnValue([]);
    mockListAll.mockReturnValue([
        lootRow({ characterKey: "aktiv", character: "Aktiv", categoryId: "c1", contentId: "bt", awardedAt: now - 2 * DAY }),
        lootRow({ characterKey: "aktiv", character: "Aktiv", categoryId: "c1", contentId: "ssc", itemId: 30000, awardedAt: now - 9 * DAY }),
        lootRow({ characterKey: "zweit", character: "Zweit", categoryId: "c1", contentId: "ssc", itemId: 30001, awardedAt: now - 20 * DAY }),
        lootRow({ characterKey: "weg", character: "Weg", categoryId: "c1", contentId: "bt", awardedAt: now - 40 * DAY }),
        lootRow({ characterKey: "heila", character: "Heila", categoryId: "c2", contentId: "bt", awardedAt: now - 5 * DAY }),
        lootRow({ characterKey: "magier", character: "Magier", categoryId: "c2", contentId: "bt", awardedAt: now - 7 * DAY }),
    ]);
    mockAnnotated.mockReturnValue([
        { key: "aktiv", className: "Priest", spec: "Shadow" },
        { key: "zweit", className: "Warlock", spec: "Destruction" },
        { key: "weg", className: "Mage", spec: "Arcane" },
        { key: "heila", className: "Priest", spec: "Holy" },
        { key: "magier", className: "Mage", spec: "Fire" },
    ]);
    mockExcludedKeys.mockReturnValue(new Set(["weg"]));
});

describe("council page and in-game council answer alike", () => {
    it("sends every Loot-Council category, each exactly as the page shows it with its stored view", async () => {
        mockViews.c1 = { role: "caster", tiers: ["t6"], contents: [], bisTier: "t6", version: "" };
        const data = await ingest("v=2");
        expect(data.format).toBe("eventhelper-council");
        expect(data.version).toBe(2);
        // c3 runs Softres; c2 follows its RCLootcouncil addon.
        expect(data.categories.map((c) => [c.id, c.name, c.lootSystem])).toEqual([["c1", "Mittwoch", "lootcouncil"], ["c2", "Sonntag", "lootcouncil"]]);

        const web1 = await page("role=caster&tiers=t6&category=c1&bisTier=t6");
        const c1 = data.categories[0];
        expect(c1.filter).toMatchObject({ role: "caster", tiers: ["t6"], contents: [], bisTier: "t6", bisTierDerived: false });
        expect(c1.raiders.map((r) => ({ key: r.key, character: r.character, need: r.need, lootCount: r.lootCount }))).toEqual(slim(web1.roster));
        expect(c1.avgLootCount).toBe(web1.avgLootCount);

        // c2 has no stored view: the page's defaults (caster, everything, derived BiS list).
        const web2 = await page("role=caster&category=c2");
        const c2 = data.categories[1];
        expect(c2.filter).toMatchObject({ role: "caster", tiers: [], contents: [], bisTierDerived: true });
        expect(c2.raiders.map((r) => ({ key: r.key, character: r.character, need: r.need, lootCount: r.lootCount }))).toEqual(slim(web2.roster));
        // A healer is not on a caster council - neither on the page nor in game.
        expect(c2.raiders.map((r) => r.character)).toEqual(["Magier"]);
    });

    it("leaves raiders the council set aside out of both", async () => {
        const data = await ingest("v=2");
        const web = await page("role=caster&category=c1");
        expect(web.roster.map((r) => r.character)).not.toContain("Weg");
        expect(data.categories[0].raiders.map((r) => r.character)).not.toContain("Weg");
        expect(data.categories[0].raiders.map((r) => r.character).sort()).toEqual(["Aktiv", "Zweit"]);
    });

    it("follows a stored role and content filter", async () => {
        mockViews.c1 = { role: "", tiers: [], contents: ["ssc"], bisTier: "", version: "" };
        const data = await ingest("v=2");
        const web = await page("contents=ssc&category=c1");
        expect(slim(web.roster)).toEqual(data.categories[0].raiders.map((r) => ({ key: r.key, character: r.character, need: r.need, lootCount: r.lootCount })));
        expect(data.categories[0].filter).toMatchObject({ role: "", contents: ["ssc"] });
    });

    it("keeps version 1 for a request naming a category, even with v=2", async () => {
        const data = await ingest("v=2&category=c1&role=caster");
        expect(data.version).toBe(1);
        expect(data.filter).toMatchObject({ category: "c1", role: "caster" });
        expect(data.raiders.map((r) => r.character)).not.toContain("Weg");
    });

    it("also answers v2 for categories=council", async () => {
        expect((await ingest("categories=council")).version).toBe(2);
        expect((await ingest("")).version).toBe(1);
    });

    it("with a roster: the same candidates on the page and in game - no stand-ins, no Ersatz (#667)", async () => {
        mockRosters.c1 = {
            id: "r1", name: "Mittwoch", categoryId: "c1", versionId: "tbc", allowMultipleChars: false,
            members: {
                1001: { status: "core", chars: ["aktiv"], charNames: { aktiv: "Aktiv" } },
                1002: { status: "bench", chars: ["zweit"], charNames: { zweit: "Zweit" } },
                1003: { status: "trial", chars: ["neu"], charNames: { neu: "Neu" } },
            },
        };
        // Neu has neither loot nor gear; only the profile knows the class.
        mockProfiles.mockReturnValue([{ userId: "1003", characters: [{ key: "neu", name: "Neu", className: "Mage", specs: [] }] }]);
        const data = await ingest("v=2");
        const web = await page("role=caster&category=c1");
        const c1 = data.categories[0];
        expect(c1.raiders.map((r) => ({ key: r.key, character: r.character, need: r.need, lootCount: r.lootCount }))).toEqual(slim(web.roster));
        expect(web.roster.map((r) => r.character).sort()).toEqual(["Aktiv", "Neu"]);
        expect(web.roster.find((r) => r.character === "Neu")).toMatchObject({ lootCount: 0, daysSinceLoot: null, status: "trial" });
        expect(c1.avgLootCount).toBe(web.avgLootCount);
        // Zweit won loot in c1 but sits on the bench: neither ranked nor a stand-in.
        expect(web.outsiders).toEqual([]);
        expect(web.filter.roster).toMatchObject({ name: "Mittwoch", counts: { core: 1, trial: 1, bench: 1, pause: 0 }, showBench: false });

        // "Ersatz zeigen" is the page's own filter; the game keeps the stored view.
        const withBench = await page("role=caster&category=c1&bench=1");
        expect(withBench.roster.map((r) => r.character).sort()).toEqual(["Aktiv", "Neu", "Zweit"]);
        expect(c1.raiders.map((r) => r.character)).not.toContain("Zweit");
    });

    it("with a roster: a stand-in from the loot shows folded on the page and never in game", async () => {
        mockRosters.c1 = {
            id: "r1", name: "Mittwoch", categoryId: "c1", versionId: "tbc", allowMultipleChars: false,
            members: { 1001: { status: "core", chars: ["aktiv"], charNames: {} } },
        };
        const data = await ingest("v=2");
        const web = await page("role=caster&category=c1");
        expect(web.roster.map((r) => r.character)).toEqual(["Aktiv"]);
        expect(web.outsiders.map((r) => r.character)).toEqual(["Zweit"]);
        expect(data.categories[0].raiders.map((r) => r.character)).toEqual(["Aktiv"]);
        expect(data.categories[0].raiders.map((r) => ({ key: r.key, character: r.character, need: r.need, lootCount: r.lootCount }))).toEqual(slim(web.roster));
    });
});
