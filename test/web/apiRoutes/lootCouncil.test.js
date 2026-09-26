// The loot council endpoints, called directly: every data source behind them is
// a factory mock, the permission check (config/permissions userCan) stays real,
// so a read-only council member and a caller without the area are the real
// rule, not a stub.
jest.mock("../../../src/web/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/apiBody", () => require("../../helpers/http").apiBodyMock({ body: () => mockBody }));
jest.mock("../../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/web/lootCouncil", () => ({
    councilRoster: jest.fn(() => ({ rows: [], avgLootCount: 0, bisTier: "t5", skipped: 0, categorySources: {} })),
    bisGaps: jest.fn(() => [{ slot: "head" }]),
    candidateSplit: jest.fn(() => ({ candidates: [{ character: "Alpha" }], cannotWear: [] })),
    filterOptions: jest.fn(() => ({ roles: ["caster"], tiers: ["t5"] })),
    resolveContentFilter: jest.fn(() => ["ssc"]),
    itemView: jest.fn((id, tier) => ({ id, tier, name: "Item" })),
    bisSpecsView: jest.fn(() => [{ spec: "Mage-Fire" }]),
}));
jest.mock("../../../src/web/bisLists", () => ({ bisLists: jest.fn((tier) => ({ tier, specs: [] })) }));
jest.mock("../../../src/web/armoryGear", () => ({
    primeArmoryGear: jest.fn(async () => ({ answered: false, configured: true })),
    clearArmoryFor: jest.fn(),
}));
jest.mock("../../../src/web/logGearStore", () => ({
    loadLogGear: jest.fn(),
    clearLogGear: jest.fn(() => true),
    recentLogs: jest.fn(() => [{ id: "rep1" }]),
}));
jest.mock("../../../src/config/tbcContent", () => ({ sourceForItem: jest.fn(() => null) }));
jest.mock("../../../src/web/simStore", () => ({
    startCouncilSim: jest.fn(() => ({ started: true, status: "running" })),
    getJob: jest.fn(() => null),
}));
jest.mock("../../../src/config/wowsims", () => ({ searchItems: jest.fn(() => []) }));
jest.mock("../../../src/web/councilStore", () => ({
    listExcluded: jest.fn(() => ({})),
    include: jest.fn(() => true),
    exclude: jest.fn((character, meta) => ({ character, ...meta, at: 5 })),
    setRole: jest.fn((character, role, meta) => (role ? { role, ...meta } : null)),
}));
jest.mock("../../../src/web/charGear", () => ({
    gearFor: jest.fn(() => null),
    charKey: jest.fn((name) => String(name).toLowerCase()),
}));
jest.mock("../../../src/web/characterStore", () => ({ characterMap: jest.fn(() => ({})) }));
jest.mock("../../../src/config/casterSpecs", () => ({
    ...jest.requireActual("../../../src/config/casterSpecs"),
    specFor: jest.fn(() => null),
}));
jest.mock("../../../src/utils/wowsims/engine", () => ({
    isAvailable: jest.fn(() => true),
    WOWSIMS_VERSION: "v0.1.2",
    buildIndividualExport: jest.fn(() => ({ supported: true, warnings: [], data: { gear: [] } })),
}));
jest.mock("../../../src/web/discord", () => ({ listCategories: jest.fn(() => []) }));
jest.mock("../../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

let mockUser = null;
let mockBody = {};

const lc = require("../../../src/web/lootCouncil");
const { bisLists } = require("../../../src/web/bisLists");
const { primeArmoryGear, clearArmoryFor } = require("../../../src/web/armoryGear");
const { loadLogGear, clearLogGear } = require("../../../src/web/logGearStore");
const { sourceForItem } = require("../../../src/config/tbcContent");
const { startCouncilSim, getJob } = require("../../../src/web/simStore");
const { searchItems } = require("../../../src/config/wowsims");
const councilStore = require("../../../src/web/councilStore");
const { gearFor } = require("../../../src/web/charGear");
const { characterMap } = require("../../../src/web/characterStore");
const { specFor } = require("../../../src/config/casterSpecs");
const engine = require("../../../src/utils/wowsims/engine");
const discord = require("../../../src/web/discord");
const { getConfig } = require("../../../src/web/settingsStore");
const routesModule = require("../../../src/web/apiRoutes/lootCouncil");
const {
    getLootCouncil, postLootCouncilSim, getLootCouncilSim, getItemSearch, getBisLists,
    postExclude, postRole, getExport, postArmoryRefresh, postLogGear, routes,
} = routesModule;
const { mockRes, status, body, json } = require("../../helpers/http");

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
            "GET /api/lootcouncil/export",
            "POST /api/lootcouncil/exclude",
            "GET /api/lootcouncil/item-search",
            "POST /api/lootcouncil/role",
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
        ["GET /api/lootcouncil/export", () => getExport],
        ["GET /api/lootcouncil/item-search", () => getItemSearch],
        ["GET /api/lootcouncil/bislists", () => getBisLists],
        ["GET /api/lootcouncil/sim", () => getLootCouncilSim],
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

describe("write access on the POST handlers", () => {
    const writers = [
        ["sim", () => postLootCouncilSim],
        ["exclude", () => postExclude],
        ["role", () => postRole],
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
        lc.councilRoster.mockReturnValue({ rows, avgLootCount: 2.5, bisTier: "t5", skipped: 3, categorySources: { c1: "signups" } });
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
        expect(lc.councilRoster).toHaveBeenCalledWith({ role: "caster", tierIds: ["t5", "t6"], contentIds: ["ssc"], categoryId: "c1", bisTier: "" });
        expect(lc.resolveContentFilter).toHaveBeenCalledWith({ tierIds: ["t5", "t6"], contentIds: ["ssc"] });
        expect(lc.bisGaps).toHaveBeenCalledWith(rows, { contentIds: ["ssc"] });
        expect(primeArmoryGear).not.toHaveBeenCalled();
        expect(discord.listCategories).toHaveBeenCalledWith("g1");

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
    });

    it("narrows to one dropped item: candidates instead of the gap list", async () => {
        const rows = [{ character: "Alpha" }];
        lc.councilRoster.mockReturnValue({ rows, avgLootCount: 0, bisTier: "t6", skipped: 0, categorySources: {} });
        const res = await call(getLootCouncil, "/api/lootcouncil", "?item=30000&bisTier=t6");
        const data = body(res);
        expect(lc.itemView).toHaveBeenCalledWith(30000, "t6");
        expect(lc.candidateSplit).toHaveBeenCalledWith(30000, rows);
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
        expect(primeArmoryGear).toHaveBeenCalledWith(["Alpha"]);
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
        expect(startCouncilSim).toHaveBeenCalledWith("job1", [{ key: "alpha", specKey: "Mage-Fire" }], [30000, 31000]);
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

        mockBody = { character: "Alpha", role: "tank" };
        res = await call(postRole, "/api/lootcouncil/role");
        expect(status(res)).toBe(400);
        expectError(res, "invalid_input", "Unbekannte Rolle: tank");
        expect(councilStore.setRole).not.toHaveBeenCalled();
    });
});

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
        expect(gearFor).toHaveBeenCalledWith("Alpha", { roleFor: expect.any(Function) });
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

    it("rejects a character without a caster spec", async () => {
        gearFor.mockReturnValue(gear({ className: "Warrior" }));
        const res = await call(getExport, "/api/lootcouncil/export", "?character=Alpha");
        expect(status(res)).toBe(400);
        expectError(res, "spec_required", "Für Alpha ist keine Caster-Spec bekannt.");
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
        expect(primeArmoryGear).toHaveBeenCalledWith(["Alpha", "Beta"], { full: true, force: true });
        expect(body(res)).toEqual({ configured: true, answered: true, fetched: 2 });
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
        expect(loadLogGear).toHaveBeenCalledWith("Alpha", { reportId: "abc", link: "https://wcl/abc" });
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
