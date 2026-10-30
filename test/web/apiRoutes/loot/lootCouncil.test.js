// The loot council endpoints, called directly: every data source behind them is
// a factory mock, the permission check (config/permissions userCan) stays real,
// so a read-only council member and a caller without the area are the real
// rule, not a stub.
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock({ body: () => mockBody }));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../../src/web/loot/lootCouncil", () => ({
    councilRoster: jest.fn(() => ({ rows: [], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {} })),
    bisGaps: jest.fn(() => [{ slot: "head" }]),
    candidateSplit: jest.fn(() => ({ candidates: [{ character: "Alpha" }], cannotWear: [] })),
    filterOptions: jest.fn(() => ({ roles: ["caster"], tiers: ["t5"] })),
    resolveContentFilter: jest.fn(() => ["ssc"]),
    itemView: jest.fn((id, tier) => ({ id, tier, name: "Item" })),
    bisSpecsView: jest.fn(() => [{ spec: "Mage-Fire" }]),
}));
jest.mock("../../../../src/web/loot/bisLists", () => ({ bisLists: jest.fn((tier) => ({ tier, specs: [] })) }));
jest.mock("../../../../src/services/loot/armoryGear", () => ({
    primeArmoryGear: jest.fn(async () => ({ answered: false, configured: true })),
    clearArmoryFor: jest.fn(),
}));
jest.mock("../../../../src/stores/loot/logGearStore", () => ({
    loadLogGear: jest.fn(),
    clearLogGear: jest.fn(() => true),
    recentLogs: jest.fn(() => [{ id: "rep1" }]),
}));
jest.mock("../../../../src/config/data/tbcContent", () => ({ ...jest.requireActual("../../../../src/config/data/tbcContent"), sourceForItem: jest.fn(() => null) }));
jest.mock("../../../../src/stores/loot/simStore", () => ({
    startCouncilSim: jest.fn(() => ({ started: true, status: "running" })),
    getJob: jest.fn(() => null),
}));
jest.mock("../../../../src/config/wowsims", () => ({ searchItems: jest.fn(() => []) }));
jest.mock("../../../../src/stores/loot/councilStore", () => ({
    listExcluded: jest.fn(() => ({})),
    include: jest.fn(() => true),
    exclude: jest.fn((character, meta) => ({ character, ...meta, at: 5 })),
    setRole: jest.fn((character, role, meta) => (role ? { role, ...meta } : null)),
    listViews: jest.fn(() => ({})),
    setView: jest.fn((category, view, meta) => ({ ...jest.requireActual("../../../../src/stores/loot/councilStore").normalizeView(view), at: 1, ...meta })),
    VIEW_DEFAULTS: { role: "caster", tiers: [], contents: [], bisTier: "", version: "" },
}));
jest.mock("../../../../src/services/loot/charGear", () => ({
    gearFor: jest.fn(() => null),
    charKey: jest.fn((name) => String(name).toLowerCase()),
}));
jest.mock("../../../../src/stores/roster/characterStore", () => ({ characterMap: jest.fn(() => ({})) }));
jest.mock("../../../../src/config/data/councilSpecs", () => ({
    ...jest.requireActual("../../../../src/config/data/councilSpecs"),
    specFor: jest.fn(() => null),
}));
jest.mock("../../../../src/utils/wowsims/engine", () => ({
    isAvailable: jest.fn(() => true),
    WOWSIMS_VERSION: "v0.1.2",
    buildIndividualExport: jest.fn(() => ({ supported: true, warnings: [], data: { gear: [] } })),
}));
jest.mock("../../../../src/services/discord/discord", () => ({ listCategories: jest.fn(() => []) }));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../../src/utils/loot/wowhead", () => ({ ...jest.requireActual("../../../../src/utils/loot/wowhead"), searchItems: jest.fn(async () => []) }));

let mockUser = null;
let mockBody = {};

const lc = require("../../../../src/web/loot/lootCouncil");
const { bisLists } = require("../../../../src/web/loot/bisLists");
const { primeArmoryGear, clearArmoryFor } = require("../../../../src/services/loot/armoryGear");
const { loadLogGear, clearLogGear, recentLogs } = require("../../../../src/stores/loot/logGearStore");
const { sourceForItem } = require("../../../../src/config/data/tbcContent");
const { startCouncilSim, getJob } = require("../../../../src/stores/loot/simStore");
const { searchItems } = require("../../../../src/config/wowsims");
const councilStore = require("../../../../src/stores/loot/councilStore");
const { gearFor } = require("../../../../src/services/loot/charGear");
const { characterMap } = require("../../../../src/stores/roster/characterStore");
const { specFor } = require("../../../../src/config/data/councilSpecs");
const engine = require("../../../../src/utils/wowsims/engine");
const discord = require("../../../../src/services/discord/discord");
const { getConfig } = require("../../../../src/stores/settings/settingsStore");
const routesModule = require("../../../../src/web/apiRoutes/loot/lootCouncil");
const {
    getLootCouncil, getOverview, postLootCouncilSim, getLootCouncilSim, getItemSearch, getBisLists,
    postExclude, postRole, getExport, postArmoryRefresh, postLogGear, getViews, postView, routes,
} = routesModule;
const { mockRes, status, body, json } = require("../../../helpers/http");
const manualBisStore = require("../../../../src/stores/loot/manualBisStore");
const wowheadUtil = require("../../../../src/utils/loot/wowhead");
const { tempStoreFile } = require("../../../helpers/tempStore");

beforeAll(() => manualBisStore.useFile(tempStoreFile("council-manual-bis.json")));
afterAll(() => manualBisStore.useFile(null));

const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const READER = { id: "2", name: "Reader", isAdmin: false, access: { lootcouncil: { read: true, write: false } } };
const WRITER = { id: "3", name: "", isAdmin: false, access: { lootcouncil: { read: true, write: true } } };
const OUTSIDER = { id: "4", name: "Outsider", isAdmin: false, access: { raids: { read: true, write: true } } };

const url = (path, query = "") => new URL(`http://localhost${path}${query}`);

/** Call a handler and hand back the response. */
async function call(handler, path = "/api/lootcouncil", query = "") {
    const res = mockRes();
    await handler({ headers: {} }, res, url(path, query));
    return res;
}

/** Asserts the exact `{ code, message }` shape of an error answer (#483: every apiError call gets a speaking code). */
function expectError(res, code, message) {
    expect(json(res).error).toEqual({ code, message });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = ADMIN;
    mockBody = {};
    // clearAllMocks keeps a mockReturnValue of an earlier test: back to the defaults.
    lc.councilRoster.mockReturnValue({ rows: [], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {} });
    councilStore.listExcluded.mockReturnValue({});
    getConfig.mockReturnValue({});
    discord.listCategories.mockReturnValue([]);
    engine.isAvailable.mockReturnValue(true);
    specFor.mockReturnValue(null);
    gearFor.mockReturnValue(null);
    characterMap.mockReturnValue({});
    searchItems.mockReturnValue([]);
    sourceForItem.mockReturnValue(null);
});

describe("the route table", () => {
    it("registers every loot council route in the lootcouncil area", () => {
        expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
            "GET /api/lootcouncil",
            "GET /api/lootcouncil/overview",
            "GET /api/lootcouncil/export",
            "POST /api/lootcouncil/exclude",
            "GET /api/lootcouncil/item-search",
            "POST /api/lootcouncil/role",
            "GET /api/lootcouncil/views",
            "POST /api/lootcouncil/view",
            "GET /api/lootcouncil/profiles",
            "GET /api/lootcouncil/profile",
            "POST /api/lootcouncil/profiles/create",
            "POST /api/lootcouncil/profiles/update",
            "POST /api/lootcouncil/profiles/delete",
            "POST /api/lootcouncil/armory",
            "POST /api/lootcouncil/loggear",
            "GET /api/lootcouncil/bislists",
            "GET /api/lootcouncil/sim",
            "POST /api/lootcouncil/sim",
        ]);
        expect(routes.every((r) => r.area === "lootcouncil" && typeof r.handler === "function")).toBe(true);
        expect(routes.find((r) => r.path === "/api/lootcouncil/export").handler).toBe(getExport);
    });
});

describe("read access on the GET handlers", () => {
    const readers = [
        ["GET /api/lootcouncil", () => getLootCouncil],
        ["GET /api/lootcouncil/overview", () => getOverview],
        ["GET /api/lootcouncil/export", () => getExport],
        ["GET /api/lootcouncil/item-search", () => getItemSearch],
        ["GET /api/lootcouncil/bislists", () => getBisLists],
        ["GET /api/lootcouncil/sim", () => getLootCouncilSim],
        ["GET /api/lootcouncil/views", () => getViews],
    ];

    it.each(readers)("%s refuses a user without the lootcouncil area with 403", async (name, handler) => {
        mockUser = OUTSIDER;
        const res = await call(handler());
        expect(status(res)).toBe(403);
        expectError(res, "forbidden", "Kein Zugriff auf den Loot-Council.");
    });

    it("refuses a caller without a session with 401 before touching any data", async () => {
        mockUser = null;
        const res = await call(getLootCouncil);
        expect(status(res)).toBe(401);
        expect(lc.councilRoster).not.toHaveBeenCalled();
    });
});

describe("GET /api/lootcouncil for a version without council content (#748)", () => {
    it("flags the content, drops gaps, filter options and the simulation, and never reads the item focus", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever" });
        const res = await call(getLootCouncil, "/api/lootcouncil", "?item=30000");
        const answer = body(res);
        // no BiS data of its own: the hand lists (#760) - none kept yet, so no focus and no gaps
        expect(answer.content).toEqual({ bis: false, sim: false, tiers: false, itemTable: false, manualBis: true, manualLists: false });
        expect(answer.versionId).toBe("forever");
        expect(answer.gaps).toEqual([]);
        expect(answer.focus).toBeNull();
        expect(lc.bisGaps).not.toHaveBeenCalled();
        expect(lc.candidateSplit).not.toHaveBeenCalled();
        expect(lc.filterOptions).toHaveBeenCalledWith(answer.content);
        expect(answer.sim.available).toBe(false);
        expect(answer.sim.hint).toMatch(/keine Simulation/);
    });

    it("on hand lists (#760): gaps and the drop focus from the lists, by need, never the TBC table", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever" });
        manualBisStore.setSlot("forever", "Priest-Shadow", 0, [{ id: 900001, name: "Kapuze", icon: "inv_helmet_01", quality: 4 }]);
        const handRow = (key, needScore, owned) => ({
            key, character: key, classColor: "", specKey: "Priest-Shadow", specLabel: "Schattenpriester", specIconUrl: "",
            needScore, needParts: {}, lootCount: 0, lootTotal: 0, otherCount: 0, items: [], daysSinceLoot: null, lastAwardAt: 0,
            gear: null, simSupported: false,
            bis: { source: "manual", owned: owned ? 1 : 0, total: 1, items: [{ id: 900001, name: "Kapuze", slot: 0, slotName: "Kopf", alternatives: [], owned, bisSpecs: [] }] },
        });
        lc.councilRoster.mockReturnValue({ rows: [handRow("anna", 0.4, false), handRow("bert", 0.9, false), handRow("cleo", 0.7, true)], avgLootCount: 0, bisTier: "", skipped: 0, categorySources: {} });
        const answer = body(await call(getLootCouncil));
        // the version has a hand list: the page needs no "no list yet" hint
        expect(answer.content).toMatchObject({ manualBis: true, manualLists: true });
        const gaps = answer.gaps;
        expect(gaps.map((g) => [g.id, g.name, g.wantedBy.map((w) => w.key)])).toEqual([[900001, "Kapuze", ["anna", "bert"]]]);
        expect(gaps[0].candidates.map((c) => c.key)).toEqual(["bert", "anna"]);
        const focus = body(await call(getLootCouncil, "/api/lootcouncil", "?item=900001")).focus;
        expect(focus.item).toMatchObject({ id: 900001, name: "Kapuze", iconUrl: expect.stringContaining("inv_helmet_01") });
        expect(focus.candidates.map((c) => c.key)).toEqual(["bert", "anna"]);
        expect(focus.owned).toEqual([expect.objectContaining({ key: "cleo", source: "worn" })]);
        expect(lc.candidateSplit).not.toHaveBeenCalled();
        expect(lc.bisGaps).not.toHaveBeenCalled();
        // the drop picker searches the hand lists
        const hits = body(await call(getItemSearch, "/api/lootcouncil/item-search", "?q=kap&v=forever")).items;
        expect(hits.map((h) => [h.id, h.name])).toEqual([[900001, "Kapuze"]]);
        expect(searchItems).not.toHaveBeenCalled();
        expect(wowheadUtil.searchItems).not.toHaveBeenCalled();
        // the weighting's exceptions (`wowhead=1`) add Wowhead of the version, without doubles
        getConfig.mockReturnValue({ mainVersion: "forever", versionSettings: { forever: { wowheadPath: "forever" } } });
        wowheadUtil.searchItems.mockResolvedValue([
            { id: 900001, name: "Kapuze", iconUrl: "a", quality: 4 },
            { id: 900003, name: "Kapuzenmantel", iconUrl: "b", quality: 3 },
        ]);
        const withWowhead = body(await call(getItemSearch, "/api/lootcouncil/item-search", "?q=kap&v=forever&wowhead=1")).items;
        expect(withWowhead.map((h) => [h.id, h.bisSpecs.length])).toEqual([[900001, 1], [900003, 0]]);
        expect(wowheadUtil.searchItems).toHaveBeenCalledWith("kap", { path: "forever", limit: 12 });
        manualBisStore.setSlot("forever", "Priest-Shadow", 0, []);
    });

    it("keeps TBC as it was", async () => {
        const answer = body(await call(getLootCouncil));
        expect(answer.content).toEqual({ bis: true, sim: true, tiers: true, itemTable: true });
        expect(answer.sim.available).toBe(true);
        expect(lc.bisGaps).toHaveBeenCalled();
    });

    it("treats BiS and the simulation switched off for TBC (#761) like no content, and says they are off", async () => {
        getConfig.mockReturnValue({ mainVersion: "tbc", versionSettings: { tbc: { wowheadPath: "tbc", disabled: ["lootCouncilBis", "simulation"] } } });
        const answer = body(await call(getLootCouncil));
        expect(answer.content).toEqual({ bis: false, sim: false, tiers: false, itemTable: false, off: true });
        expect(answer.gaps).toEqual([]);
        expect(answer.sim.available).toBe(false);
        expect(answer.sim.hint).toBe("Simulation ist für TBC Anniversary ausgeschaltet (Einstellungen → Spielversion).");
    });
});

describe("write access on the POST handlers", () => {
    const writers = [
        ["sim", () => postLootCouncilSim],
        ["exclude", () => postExclude],
        ["role", () => postRole],
        ["view", () => postView],
        ["armory", () => postArmoryRefresh],
        ["loggear", () => postLogGear],
    ];

    it.each(writers)("POST %s refuses a read-only council member with 403", async (name, handler) => {
        mockUser = READER;
        mockBody = { id: "job", character: "Alpha", characters: ["Alpha"], subjects: [{ key: "a", specKey: "b" }] };
        const res = await call(handler(), `/api/lootcouncil/${name}`);
        expect(status(res)).toBe(403);
        expect(json(res).error).toEqual({ code: "forbidden", message: "Keine Schreibrechte für „Loot-Council“." });
        expect(councilStore.exclude).not.toHaveBeenCalled();
        expect(startCouncilSim).not.toHaveBeenCalled();
    });
});

describe("GET /api/lootcouncil", () => {
    it("builds the whole picture from stored data with the filters from the query", async () => {
        const rows = [{ character: "Alpha", gear: { dropped: [] } }];
        lc.councilRoster.mockReturnValue({
            rows, avgLootCount: 2.5, bisTier: "t5", skipped: 3, categorySources: { c1: "signups" }, setAside: ["old", "newer", "undated"],
        });
        councilStore.listExcluded.mockReturnValue({
            old: { reason: "left", at: 10 },
            newer: { reason: "break", at: 20 },
            undated: { reason: "?" },
        });
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"] });
        discord.listCategories.mockReturnValue([{ id: "c1", name: "Raids T5" }]);
        mockUser = READER;

        const res = await call(getLootCouncil, "/api/lootcouncil", "?role=caster&tiers=t5, t6,&contents=ssc&category=c1");
        expect(status(res)).toBe(200);
        expect(lc.councilRoster).toHaveBeenCalledWith({
            role: "caster", tierIds: ["t5", "t6"], contentIds: ["ssc"], categoryId: "c1", rosterId: "", bisTier: "", showBench: false, versionId: "tbc", guildId: "g1",
            config: { categoryIds: ["c1", "c2"] }, mainVersion: "tbc", charVersion: "tbc",
        });
        expect(lc.resolveContentFilter).toHaveBeenCalledWith({ tierIds: ["t5", "t6"], contentIds: ["ssc"] });
        expect(lc.bisGaps).toHaveBeenCalledWith(rows, { contentIds: ["ssc"], versionId: "tbc", guildId: "g1" });
        expect(primeArmoryGear).not.toHaveBeenCalled();
        expect(discord.listCategories).toHaveBeenCalledWith("g1");
        // the logs offered to pick from: the active server's only (#920)
        expect(recentLogs).toHaveBeenCalledWith(undefined, { guildId: "g1" });

        const data = body(res);
        expect(data).toMatchObject({
            roster: rows,
            avgLootCount: 2.5,
            recentLogs: [{ id: "rep1" }],
            gaps: [{ slot: "head" }],
            focus: null,
            options: { roles: ["caster"], tiers: ["t5"], categories: [{ id: "c1", name: "Raids T5" }, { id: "c2", name: "c2" }] },
            filter: {
                role: "caster", tierIds: ["t5", "t6"], contentIds: ["ssc"], categoryId: "c1",
                bisTier: "t5", bisTierDerived: true, skipped: 3, categorySources: { c1: "signups" },
            },
            sim: { available: true, version: "v0.1.2", hint: "" },
            activeGuildId: "g1",
        });
        expect(data.excluded).toEqual([
            { key: "newer", reason: "break", at: 20 },
            { key: "old", reason: "left", at: 10 },
            { key: "undated", reason: "?" },
        ]);
        // The version filter (#545): nothing asked = the main version.
        expect(data.version).toBe("tbc");
        expect(data.mainVersion).toBe("tbc");
    });

    // The store is one list for every version and roster: a TBC raider set
    // aside there must not show up as „Nicht eingeplant“ in the Forever council.
    it("names only those set aside who this view would otherwise list", async () => {
        lc.councilRoster.mockReturnValue({ rows: [], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {}, setAside: ["hier"] });
        councilStore.listExcluded.mockReturnValue({
            hier: { character: "Hier", at: 2 },
            tbcchar: { character: "Tbcchar", at: 3 },
        });
        const data = body(await call(getLootCouncil, "/api/lootcouncil", "?version=forever"));
        expect(data.excluded).toEqual([{ key: "hier", character: "Hier", at: 2 }]);
    });

    it("names nobody when the view set nobody aside", async () => {
        councilStore.listExcluded.mockReturnValue({ tbcchar: { character: "Tbcchar", at: 3 } });
        expect(body(await call(getLootCouncil)).excluded).toEqual([]);
    });

    it("hands the category's roster and its stand-ins to the page, and asks for Ersatz only with bench=1 (#667)", async () => {
        const rosterSource = { id: "r1", name: "Mittwoch", versionId: "tbc", counts: { core: 2, trial: 1, bench: 1, pause: 1 }, showBench: true, noSpec: [] };
        const outsiders = [{ key: "aushilfe", character: "Aushilfe", status: "" }];
        lc.councilRoster.mockReturnValue({ rows: [], avgLootCount: 0, bisTier: "t5", skipped: {}, categorySources: {}, rosterSource, outsiders });
        mockUser = READER;

        const res = await call(getLootCouncil, "/api/lootcouncil", "?category=c1&bench=1");
        expect(lc.councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1", showBench: true }));
        expect(body(res).filter.roster).toEqual(rosterSource);
        expect(body(res).outsiders).toEqual(outsiders);

        lc.councilRoster.mockReturnValue({ rows: [], avgLootCount: 0, bisTier: "t5", skipped: {}, categorySources: null });
        const plain = await call(getLootCouncil, "/api/lootcouncil", "");
        expect(lc.councilRoster).toHaveBeenLastCalledWith(expect.objectContaining({ showBench: false }));
        expect(body(plain).filter.roster).toBeNull();
        expect(body(plain).outsiders).toEqual([]);
    });

    it("passes the game version filter through; 'all' is no answer for the page (#545, #741)", async () => {
        lc.councilRoster.mockReturnValue({
            rows: [], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {}, versions: [{ id: "tbc", label: "TBC", short: "TBC", count: 3 }],
        });
        mockUser = READER;

        const forever = await call(getLootCouncil, "/api/lootcouncil", "?version=forever");
        expect(lc.councilRoster).toHaveBeenCalledWith(expect.objectContaining({ charVersion: "forever", mainVersion: "tbc" }));
        expect(body(forever).version).toBe("forever");
        expect(body(forever).versions).toEqual([{ id: "tbc", label: "TBC", short: "TBC", count: 3 }]);

        // strictly one version at a time (#741): "all" falls back to the main version
        const all = await call(getLootCouncil, "/api/lootcouncil", "?version=all");
        expect(lc.councilRoster).toHaveBeenLastCalledWith(expect.objectContaining({ charVersion: "tbc" }));
        expect(body(all).version).toBe("tbc");
    });

    it("narrows to one dropped item: candidates instead of the gap list", async () => {
        const rows = [{ character: "Alpha" }];
        lc.councilRoster.mockReturnValue({ rows, avgLootCount: 0, bisTier: "t6", skipped: 0, categorySources: {} });
        const res = await call(getLootCouncil, "/api/lootcouncil", "?item=30000&bisTier=t6");
        const data = body(res);
        expect(lc.itemView).toHaveBeenCalledWith(30000, "t6");
        expect(lc.candidateSplit).toHaveBeenCalledWith(30000, rows, null, { versionId: "tbc", guildId: "g1" });
        expect(lc.bisGaps).not.toHaveBeenCalled();
        expect(data.gaps).toEqual([]);
        expect(data.focus).toEqual({ item: { id: 30000, tier: "t6", name: "Item" }, candidates: [{ character: "Alpha" }], cannotWear: [] });
        expect(data.filter.bisTierDerived).toBe(false);
        expect(data.options.categories).toEqual([]);
    });

    it("says why there is no gain without a simulator binary", async () => {
        engine.isAvailable.mockReturnValue(false);
        const res = await call(getLootCouncil);
        expect(body(res).sim).toEqual({
            available: false,
            version: "v0.1.2",
            hint: expect.stringContaining("WOWSIMCLI_PATH nicht gesetzt"),
        });
    });

    it("asks the armory only for raiders with a dropped boss piece and rebuilds when it answered", async () => {
        const first = { rows: [{ character: "Alpha", gear: { dropped: ["x"] } }, { character: "Beta", gear: { dropped: [] } }, { character: "Gamma" }], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {} };
        const second = { ...first, rows: [{ character: "Alpha", gear: { dropped: [] } }] };
        lc.councilRoster.mockReturnValueOnce(first).mockReturnValueOnce(second);
        primeArmoryGear.mockResolvedValueOnce({ answered: true });
        const res = await call(getLootCouncil);
        expect(primeArmoryGear).toHaveBeenCalledWith(["Alpha"], { versionId: "tbc", guildId: "g1" });
        expect(lc.councilRoster).toHaveBeenCalledTimes(2);
        expect(body(res).roster).toEqual(second.rows);
    });

    it("keeps the first roster when the armory does not answer or fails", async () => {
        const first = { rows: [{ character: "Alpha", gear: { dropped: ["x"] } }], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {} };
        lc.councilRoster.mockReturnValue(first);
        primeArmoryGear.mockResolvedValueOnce({ answered: false });
        let res = await call(getLootCouncil);
        expect(lc.councilRoster).toHaveBeenCalledTimes(1);
        expect(body(res).roster).toEqual(first.rows);

        jest.clearAllMocks();
        primeArmoryGear.mockRejectedValueOnce(new Error("armory down"));
        res = await call(getLootCouncil);
        expect(status(res)).toBe(200);
        expect(lc.councilRoster).toHaveBeenCalledTimes(1);
        expect(body(res).roster).toEqual(first.rows);
    });
});

describe("POST /api/lootcouncil/sim", () => {
    it("starts the simulation with clean subjects and numeric items", async () => {
        mockUser = WRITER;
        mockBody = {
            id: " job1 ",
            subjects: [{ key: " alpha ", specKey: "Mage-Fire" }, { key: "beta" }, null, { key: "", specKey: "x" }],
            items: ["30000", 0, -1, "abc", 31000],
        };
        const res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(startCouncilSim).toHaveBeenCalledWith("job1", [{ key: "alpha", specKey: "Mage-Fire" }], [30000, 31000], { versionId: "tbc", guildId: "g1" });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ started: true, status: "running", id: "job1" });
    });

    it("rejects a missing job id and a list without raiders", async () => {
        mockBody = { subjects: [{ key: "a", specKey: "b" }] };
        let res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Job-Id fehlt.");

        mockBody = { id: "job", subjects: "nope" };
        res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Keine Raider angegeben.");
        expect(startCouncilSim).not.toHaveBeenCalled();
    });

    it("refuses a version without simulation data (#745), read from the category like the page", async () => {
        getConfig.mockReturnValue({ mainVersion: "tbc", categoryVersion: { c9: "forever" } });
        // The page sends its menu version with the category (#741: a Forever category is picked only in the Forever menu).
        mockBody = { id: "job", subjects: [{ key: "a", specKey: "b" }], category: "c9", version: "forever" };
        let res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(status(res)).toBe(409);
        expectError(res, "no_sim_data", "Für diese Spielversion gibt es keine Simulation.");

        mockBody = { id: "job", subjects: [{ key: "a", specKey: "b" }], version: "forever" };
        res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(status(res)).toBe(409);
        expect(startCouncilSim).not.toHaveBeenCalled();
    });

    it("refuses when the simulation is switched off for the version (#745)", async () => {
        getConfig.mockReturnValue({ mainVersion: "tbc", versionSettings: { tbc: { wowheadPath: "tbc", disabled: ["simulation"] } } });
        mockBody = { id: "job", subjects: [{ key: "a", specKey: "b" }] };
        const res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(status(res)).toBe(409);
        expectError(res, "feature_off", "Simulation ist für TBC Anniversary ausgeschaltet (Einstellungen → Spielversion).");
        expect(startCouncilSim).not.toHaveBeenCalled();
    });

    it("answers 503 without a simulator and starts nothing", async () => {
        engine.isAvailable.mockReturnValue(false);
        mockBody = { id: "job", subjects: [{ key: "a", specKey: "b" }] };
        const res = await call(postLootCouncilSim, "/api/lootcouncil/sim");
        expect(status(res)).toBe(503);
        expectError(res, "sim_unavailable", "Keine WoWSims-Simulation verfügbar — WOWSIMCLI_PATH ist nicht gesetzt.");
        expect(startCouncilSim).not.toHaveBeenCalled();
    });
});

describe("GET /api/lootcouncil/sim", () => {
    it("polls a known job", async () => {
        getJob.mockReturnValueOnce({ status: "done", results: [1] });
        const res = await call(getLootCouncilSim, "/api/lootcouncil/sim", "?id=job1");
        expect(getJob).toHaveBeenCalledWith("job1");
        expect(body(res)).toEqual({ status: "done", results: [1] });
    });

    it("answers status unknown for a job it does not know", async () => {
        const res = await call(getLootCouncilSim, "/api/lootcouncil/sim");
        expect(getJob).toHaveBeenCalledWith("");
        expect(body(res)).toEqual({ status: "unknown" });
    });
});

describe("POST /api/lootcouncil/exclude", () => {
    it("excludes a raider with reason and the acting user's name", async () => {
        mockBody = { character: " Alpha ", reason: " left the guild " };
        const res = await call(postExclude, "/api/lootcouncil/exclude");
        expect(councilStore.exclude).toHaveBeenCalledWith("Alpha", { reason: "left the guild", by: "Admin" });
        expect(body(res)).toEqual({ character: "Alpha", excluded: true, entry: { character: "Alpha", reason: "left the guild", by: "Admin", at: 5 } });
    });

    it("falls back to the user id when the user has no name", async () => {
        mockUser = WRITER;
        mockBody = { character: "Alpha" };
        await call(postExclude, "/api/lootcouncil/exclude");
        expect(councilStore.exclude).toHaveBeenCalledWith("Alpha", { reason: "", by: "3" });
    });

    it("takes a raider back in with exclude: false", async () => {
        mockBody = { character: "Alpha", exclude: false };
        const res = await call(postExclude, "/api/lootcouncil/exclude");
        expect(councilStore.include).toHaveBeenCalledWith("Alpha");
        expect(councilStore.exclude).not.toHaveBeenCalled();
        expect(body(res)).toEqual({ character: "Alpha", excluded: false, changed: true });
    });

    it("rejects a missing character, and one the store refuses", async () => {
        mockBody = { character: "  " };
        let res = await call(postExclude, "/api/lootcouncil/exclude");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Kein Charakter angegeben.");

        councilStore.exclude.mockReturnValueOnce(null);
        mockBody = { character: "Alpha" };
        res = await call(postExclude, "/api/lootcouncil/exclude");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Kein Charakter angegeben.");
    });
});

describe("POST /api/lootcouncil/role", () => {
    it("pins a raider to a known role", async () => {
        mockBody = { character: "Alpha", role: "healer" };
        const res = await call(postRole, "/api/lootcouncil/role");
        expect(councilStore.setRole).toHaveBeenCalledWith("Alpha", "healer", { by: "Admin" });
        expect(body(res)).toEqual({ character: "Alpha", role: "healer", entry: { role: "healer", by: "Admin" } });
    });

    it("clears the role with an empty one", async () => {
        mockUser = WRITER;
        mockBody = { character: "Alpha", role: "" };
        const res = await call(postRole, "/api/lootcouncil/role");
        expect(councilStore.setRole).toHaveBeenCalledWith("Alpha", "", { by: "3" });
        expect(body(res)).toEqual({ character: "Alpha", role: "", entry: null });
    });

    it("rejects a missing character and an unknown role", async () => {
        mockBody = { role: "caster" };
        let res = await call(postRole, "/api/lootcouncil/role");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Kein Charakter angegeben.");

        mockBody = { character: "Alpha", role: "dragon" };
        res = await call(postRole, "/api/lootcouncil/role");
        expect(status(res)).toBe(400);
        expectError(res, "invalid_input", "Unbekannte Rolle: dragon");
        expect(councilStore.setRole).not.toHaveBeenCalled();
    });

    it("accepts the roles the council gained with #669", async () => {
        for (const role of ["tank", "melee", "ranged"]) {
            councilStore.setRole.mockClear();
            mockBody = { character: "Alpha", role };
            const res = await call(postRole, "/api/lootcouncil/role");
            expect(status(res)).toBe(200);
            expect(councilStore.setRole).toHaveBeenCalledWith("Alpha", role, expect.anything());
        }
    });
});

// GET /api/lootcouncil/views and POST /api/lootcouncil/view work on the
// Loot-Council profiles since #676: lootCouncil.profiles.test.js (real stores).

describe("GET /api/lootcouncil/export", () => {
    const SPEC = { key: "Mage-Fire", label: "Feuer-Magier", role: "caster", simSpec: "mage" };
    const gear = (over = {}) => ({
        character: "Alpha",
        className: "Mage",
        seenAt: 1700000000,
        reportTitle: "SSC Monday",
        items: [
            { itemName: "Old Trinket", replacedSituational: { itemName: "Shiffar's Nexus-Horn", note: "nur auf Lurker" } },
            { itemName: "Band of Eternity", situational: { note: "ist situativ" } },
            { itemName: "Plain Robe" },
        ],
        ...over,
    });

    it("builds the WoWSims import with the spec the page judged by and names every substitution", async () => {
        characterMap.mockReturnValue({ alpha: { className: "Mage", spec: "Fire" } });
        specFor.mockReturnValue(SPEC);
        gearFor.mockReturnValue(gear());
        engine.buildIndividualExport.mockReturnValueOnce({ supported: true, warnings: ["Talente geschätzt."], data: { player: 1 } });

        const res = await call(getExport, "/api/lootcouncil/export", "?character=Alpha");
        expect(specFor).toHaveBeenCalledWith("Mage", "Fire");
        expect(gearFor).toHaveBeenCalledWith("Alpha", { roleFor: expect.any(Function), versionId: "tbc", guildId: "g1" });
        expect(gearFor.mock.calls[0][1].roleFor()).toBe("caster");
        expect(engine.buildIndividualExport).toHaveBeenCalledWith({ gear: gear(), specEntry: SPEC });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({
            character: "Alpha",
            spec: "Mage-Fire",
            specLabel: "Feuer-Magier",
            simUrl: "https://www.wowsims.com/tbc/mage/dps/",
            seenAt: 1700000000,
            reportTitle: "SSC Monday",
            warnings: [
                "Talente geschätzt.",
                "Statt „Shiffar's Nexus-Horn“ (nur auf Lurker) steht hier „Old Trinket“ aus einer älteren Auswertung.",
                "„Band of Eternity“ ist situativ — keine ältere Auswertung zeigt etwas anderes auf dem Slot.",
            ],
            json: JSON.stringify({ player: 1 }, null, 2),
        });
    });

    it("reads the gear in the page's version and on the active server (#923)", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever" });
        specFor.mockReturnValue(SPEC);
        gearFor.mockReturnValue(gear({ items: [] }));
        await call(getExport, "/api/lootcouncil/export", "?character=Alpha&version=forever");
        expect(gearFor).toHaveBeenCalledWith("Alpha", expect.objectContaining({ versionId: "forever", guildId: "g1" }));
    });

    it("falls back to the class from the gear and to the generic sim page", async () => {
        specFor.mockReturnValueOnce(null).mockReturnValueOnce({ key: "Paladin-Holy", label: "Holy", simSpec: "other" });
        gearFor.mockReturnValue(gear({ className: "Paladin", items: [] }));
        const res = await call(getExport, "/api/lootcouncil/export", "?character=Beta");
        expect(gearFor.mock.calls[0][1].roleFor()).toBe("");
        expect(specFor).toHaveBeenLastCalledWith("Paladin", undefined);
        expect(body(res).simUrl).toBe("https://www.wowsims.com/tbc/");
        expect(body(res).warnings).toEqual([]);
    });

    it("finds the sim page through the simSpec when the key has none of its own", async () => {
        specFor.mockReturnValue({ key: "Other", label: "Other", simSpec: "Druid-Balance" });
        gearFor.mockReturnValue(gear({ items: [] }));
        const res = await call(getExport, "/api/lootcouncil/export", "?character=Alpha");
        expect(body(res).simUrl).toBe("https://www.wowsims.com/tbc/druid/balance/");
    });

    it("rejects a missing character", async () => {
        const res = await call(getExport, "/api/lootcouncil/export", "?character=%20");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Kein Charakter angegeben.");
        expect(gearFor).not.toHaveBeenCalled();
    });

    it("answers 404 for a character without known gear", async () => {
        const res = await call(getExport, "/api/lootcouncil/export", "?character=Ghost");
        expect(status(res)).toBe(404);
        expectError(res, "not_found", "Für Ghost ist kein Gear bekannt — der Charakter taucht in keiner der letzten CLA-Auswertungen auf.");
    });

    it("rejects a character without a council spec", async () => {
        // A warrior without a spec could be fury or protection — no guess.
        gearFor.mockReturnValue(gear({ className: "Warrior" }));
        const res = await call(getExport, "/api/lootcouncil/export", "?character=Alpha");
        expect(status(res)).toBe(400);
        expectError(res, "spec_required", "Für Alpha ist keine Council-Spec bekannt.");
    });

    it("passes on why the engine cannot export a spec, with a default sentence", async () => {
        specFor.mockReturnValue(SPEC);
        gearFor.mockReturnValue(gear());
        engine.buildIndividualExport.mockReturnValueOnce({ supported: false, warnings: ["Spec fehlt.", "Talente fehlen."] });
        let res = await call(getExport, "/api/lootcouncil/export", "?character=Alpha");
        expect(status(res)).toBe(400);
        expectError(res, "unsupported", "Spec fehlt. Talente fehlen.");

        engine.buildIndividualExport.mockReturnValueOnce({ supported: false, warnings: [] });
        res = await call(getExport, "/api/lootcouncil/export", "?character=Alpha");
        expectError(res, "unsupported", "Diese Spec lässt sich nicht exportieren.");
    });
});

describe("GET /api/lootcouncil/item-search", () => {
    it("adds the drop source and the BiS specs to every hit", async () => {
        searchItems.mockReturnValue([{ id: 30000, name: "Hat" }, { id: 30001, name: "Robe" }]);
        sourceForItem.mockImplementation((id) => (id === 30000 ? { content: "ssc", boss: "Vashj" } : null));
        const res = await call(getItemSearch, "/api/lootcouncil/item-search", "?q=ha&tier=t5");
        expect(searchItems).toHaveBeenCalledWith("ha");
        expect(lc.bisSpecsView).toHaveBeenCalledWith(30000, "t5");
        expect(body(res)).toEqual({
            items: [
                { id: 30000, name: "Hat", contentId: "ssc", boss: "Vashj", bisSpecs: [{ spec: "Mage-Fire" }] },
                { id: 30001, name: "Robe", contentId: "", boss: "", bisSpecs: [{ spec: "Mage-Fire" }] },
            ],
        });
    });

    it("has no item table to search for a version without council content (#748)", async () => {
        searchItems.mockReturnValue([{ id: 30000, name: "Hat" }]);
        const res = await call(getItemSearch, "/api/lootcouncil/item-search", "?q=ha&v=forever");
        expect(searchItems).not.toHaveBeenCalled();
        expect(body(res)).toEqual({ items: [] });
        getConfig.mockReturnValue({ mainVersion: "forever" });
        expect(body(await call(getItemSearch, "/api/lootcouncil/item-search", "?q=ha")).items).toEqual([]);
    });

    it("searches with an empty query when none is given", async () => {
        const res = await call(getItemSearch, "/api/lootcouncil/item-search");
        expect(searchItems).toHaveBeenCalledWith("");
        expect(lc.bisSpecsView).not.toHaveBeenCalled();
        expect(body(res)).toEqual({ items: [] });
    });
});

describe("GET /api/lootcouncil/bislists", () => {
    it("hands out the matrix for the asked tier", async () => {
        mockUser = READER;
        const res = await call(getBisLists, "/api/lootcouncil/bislists", "?tier=t6");
        expect(bisLists).toHaveBeenCalledWith("t6");
        expect(body(res)).toEqual({ tier: "t6", specs: [] });
    });

    it("asks for the default tier without a query", async () => {
        await call(getBisLists, "/api/lootcouncil/bislists");
        expect(bisLists).toHaveBeenCalledWith("");
    });
});

describe("POST /api/lootcouncil/armory", () => {
    it("fetches the current gear of the named raiders, forced and in full", async () => {
        mockBody = { characters: ["Alpha", "Beta"] };
        primeArmoryGear.mockResolvedValueOnce({ configured: true, answered: true, fetched: 2 });
        const res = await call(postArmoryRefresh, "/api/lootcouncil/armory");
        expect(primeArmoryGear).toHaveBeenCalledWith(["Alpha", "Beta"], { full: true, force: true, versionId: "tbc", guildId: "g1" });
        expect(body(res)).toEqual({ configured: true, answered: true, fetched: 2 });
    });

    it("reads the armory in the version of the page's roster or menu (#923)", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever" });
        mockBody = { characters: ["Alpha"], version: "forever" };
        primeArmoryGear.mockResolvedValueOnce({ configured: true, answered: true, fetched: 1 });
        await call(postArmoryRefresh, "/api/lootcouncil/armory");
        expect(primeArmoryGear).toHaveBeenCalledWith(["Alpha"], { full: true, force: true, versionId: "forever", guildId: "g1" });
    });

    it("rejects an empty list and a missing Battle.net configuration", async () => {
        mockBody = { characters: "Alpha" };
        let res = await call(postArmoryRefresh, "/api/lootcouncil/armory");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Keine Charaktere angegeben.");
        expect(primeArmoryGear).not.toHaveBeenCalled();

        mockBody = { characters: ["Alpha"] };
        primeArmoryGear.mockResolvedValueOnce({ configured: false });
        res = await call(postArmoryRefresh, "/api/lootcouncil/armory");
        expect(status(res)).toBe(400);
        expectError(res, "armory_not_configured", "Für die Armory fehlen die Battle.net-Zugangsdaten (Einstellungen → Verbindungen).");
    });
});

describe("POST /api/lootcouncil/loggear", () => {
    it("loads a raider's gear from a log and drops the armory answer", async () => {
        mockBody = { character: " Alpha ", reportId: "abc", link: "https://wcl/abc" };
        loadLogGear.mockResolvedValueOnce({
            snapshot: { reportId: "abc", reportTitle: "SSC", reportStart: 1700, armory: [{}, {}, {}] },
            tried: ["abc"],
        });
        const res = await call(postLogGear, "/api/lootcouncil/loggear");
        expect(loadLogGear).toHaveBeenCalledWith("Alpha", { reportId: "abc", link: "https://wcl/abc", guildId: "g1" });
        expect(clearArmoryFor).toHaveBeenCalledWith("Alpha");
        expect(body(res)).toEqual({ reportId: "abc", reportTitle: "SSC", reportStart: 1700, items: 3, tried: ["abc"] });
    });

    it("forgets a loaded log and the armory answer with clear", async () => {
        mockBody = { character: "Alpha", clear: true };
        const res = await call(postLogGear, "/api/lootcouncil/loggear");
        expect(clearLogGear).toHaveBeenCalledWith("Alpha");
        expect(clearArmoryFor).toHaveBeenCalledWith("Alpha");
        expect(loadLogGear).not.toHaveBeenCalled();
        expect(body(res)).toEqual({ cleared: true });
    });

    it("rejects a missing character", async () => {
        mockBody = {};
        const res = await call(postLogGear, "/api/lootcouncil/loggear");
        expect(status(res)).toBe(400);
        expectError(res, "bad_request", "Kein Charakter angegeben.");
    });

    it("answers a log-gear failure with its own status, 404 by default", async () => {
        mockBody = { character: "Alpha" };
        loadLogGear.mockRejectedValueOnce(Object.assign(new Error("Kein Log gefunden."), { logGear: true, status: 422 }));
        let res = await call(postLogGear, "/api/lootcouncil/loggear");
        expect(status(res)).toBe(422);
        expectError(res, "log_gear", "Kein Log gefunden.");

        loadLogGear.mockRejectedValueOnce(Object.assign(new Error("Nicht im Log."), { logGear: true }));
        res = await call(postLogGear, "/api/lootcouncil/loggear");
        expect(status(res)).toBe(404);
        expect(clearArmoryFor).not.toHaveBeenCalled();
    });

    it("lets any other failure through to the router", async () => {
        mockBody = { character: "Alpha" };
        loadLogGear.mockRejectedValueOnce(new Error("disk full"));
        await expect(call(postLogGear, "/api/lootcouncil/loggear")).rejects.toThrow("disk full");
    });
});

// The user's report: in the Forever council, "Council für" still offered
// "Montagsraid · TBC Montag" and "PUG Raids" (TBC). The menu's version comes
// first (#741/#563): another version's category is no pick and no option.
describe("GET /api/lootcouncil keeps to the menu's version", () => {
    const CONFIG = {
        categoryIds: ["tbcCat", "foreverCat"], mainVersion: "forever", categoryVersion: { tbcCat: "tbc", foreverCat: "forever" },
        categoryLootSystem: { tbcCat: "lootcouncil", foreverCat: "lootcouncil" },
    };
    beforeEach(() => {
        getConfig.mockReturnValue(CONFIG);
        discord.listCategories.mockReturnValue([{ id: "tbcCat", name: "PUG Raids" }, { id: "foreverCat", name: "Forever Mittwoch" }]);
    });

    it("drops a stored TBC category pick: the Forever council of every Forever category, and names the pick", async () => {
        const data = body(await call(getLootCouncil, "/api/lootcouncil", "?category=tbcCat&version=forever"));
        expect(lc.councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "", rosterId: "", versionId: "forever", charVersion: "forever" }));
        expect(data.council.dropped).toEqual({ kind: "category", id: "tbcCat", versionId: "tbc" });
        expect(data.council.target).toBe("all");
        expect(data.council.categories.map((c) => c.id)).toEqual(["foreverCat"]);
        expect(data.options.categories).toEqual([{ id: "foreverCat", name: "Forever Mittwoch" }]);
        expect(data.versionId).toBe("forever");
    });

    it("keeps a pick of the menu's version", async () => {
        const data = body(await call(getLootCouncil, "/api/lootcouncil", "?category=tbcCat&version=tbc"));
        expect(lc.councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "tbcCat", versionId: "tbc", charVersion: "tbc" }));
        expect(data.council.dropped).toBeNull();
        expect(data.council.target).toBe("category");
        expect(data.options.categories.map((c) => c.id)).toEqual(["tbcCat"]);
    });

    it("drops the TBC pick while other versions are hidden, whatever the url asks", async () => {
        getConfig.mockReturnValue({ ...CONFIG, hideOtherVersions: true });
        const data = body(await call(getLootCouncil, "/api/lootcouncil", "?category=tbcCat&version=tbc"));
        expect(lc.councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "", charVersion: "forever" }));
        expect(data.council.dropped).toEqual({ kind: "category", id: "tbcCat", versionId: "tbc" });
        expect(data.council.categories.map((c) => c.id)).toEqual(["foreverCat"]);
    });
});

// The page's entry (Oct 2026): tiles of the menu's version, only what runs as Loot-Council.
describe("GET /api/lootcouncil/overview", () => {
    const CONFIG = {
        categoryIds: ["tbcCat", "foreverCat", "softresCat"], mainVersion: "forever",
        categoryVersion: { tbcCat: "tbc", foreverCat: "forever", softresCat: "forever" },
        categoryLootSystem: { tbcCat: "lootcouncil", foreverCat: "lootcouncil", softresCat: "softres" },
    };
    beforeEach(() => {
        getConfig.mockReturnValue(CONFIG);
        discord.listCategories.mockReturnValue([{ id: "tbcCat", name: "PUG Raids" }, { id: "foreverCat", name: "Forever Mittwoch" }, { id: "softresCat", name: "Forever Sonntag" }]);
    });

    it("answers the Loot-Council tiles of the menu's version, without building a council", async () => {
        const data = body(await call(getOverview, "/api/lootcouncil/overview", "?version=forever"));
        expect(data.versionId).toBe("forever");
        expect(data.tiles.map((t) => `${t.kind}:${t.id}`)).toEqual(["category:foreverCat"]);
        expect(data.tiles[0]).toMatchObject({ name: "Forever Mittwoch", versionId: "forever", profileName: "Standard", members: null });
        expect(lc.councilRoster).not.toHaveBeenCalled();
        const tbc = body(await call(getOverview, "/api/lootcouncil/overview", "?version=tbc"));
        expect(tbc.tiles.map((t) => t.id)).toEqual(["tbcCat"]);
    });
});
