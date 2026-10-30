// The editor of the hand-maintained BiS lists (#760) through the real router:
// reading takes `lootcouncil` read, writing `lootcouncil` write; names come
// from Wowhead of the version, never from the request; an item Wowhead does
// not know (yet) is kept by its id. Item ids are test ids, not game data.
let mockUser = null;
let mockConfig = {};
jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../../../src/utils/loot/wowhead"),
    lookupItem: jest.fn(),
    searchItems: jest.fn(),
}));

const wowhead = require("../../../../src/utils/loot/wowhead");
const store = require("../../../../src/stores/manualBisStore");
const route = require("../../../../src/web/apiRoutes/loot/lootCouncilBis");
const { emptyAccess } = require("../../../../src/config/permissions");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { routerClient, status, body, json } = require("../../../helpers/http");

const { get, post } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const READER = { id: "2", name: "Leser", isAdmin: false, access: { ...emptyAccess(), lootcouncil: { read: true, write: false } } };
const WRITER = { id: "3", name: "Orga", isAdmin: false, access: { ...emptyAccess(), lootcouncil: { read: true, write: true } } };
const OUTSIDER = { id: "4", name: "Raider", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: true } } };
const FOREVER = { mainVersion: "forever", versionSettings: { forever: { wowheadPath: "forever" } } };
const code = (res) => (json(res).error || {}).code;

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("council-manual-bis.json"));
    mockUser = ADMIN;
    mockConfig = FOREVER;
    wowhead.lookupItem.mockResolvedValue(null);
    wowhead.searchItems.mockResolvedValue([]);
});
afterAll(() => store.useFile(null));

describe("GET /api/lootcouncil/manual-bis", () => {
    it("answers the version's specs, slots and lists - empty to begin with", async () => {
        mockUser = READER;
        const res = await get("/api/lootcouncil/manual-bis", { version: "forever" });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data).toMatchObject({ versionId: "forever", versionLabel: "WoW Forever", available: true, off: false, search: true, maxPerSlot: 3, lists: {} });
        expect(data.slots.map((s) => s.slot)).toEqual(store.MANUAL_SLOTS);
        expect(data.slots[0]).toEqual({ slot: 0, slotName: "Kopf" });
        const shadow = data.specs.find((s) => s.key === "Priest-Shadow");
        expect(shadow).toMatchObject({ label: "Schattenpriester", role: "caster", filled: 0 });
        expect(shadow.iconUrl).not.toBe("");
    });

    it("says TBC keeps no hand lists, and a version without Wowhead path searches nothing", async () => {
        expect(body(await get("/api/lootcouncil/manual-bis", { version: "tbc" }))).toMatchObject({ versionId: "tbc", available: false });
        mockConfig = { mainVersion: "forever", versionSettings: { forever: {} } };
        expect(body(await get("/api/lootcouncil/manual-bis", { version: "forever" })).search).toBe(false);
    });

    it("refuses a caller without the loot council", async () => {
        mockUser = OUTSIDER;
        expect(status(await get("/api/lootcouncil/manual-bis", { version: "forever" }))).toBe(403);
    });
});

describe("GET /api/lootcouncil/manual-bis/search", () => {
    it("asks Wowhead of the version by name, or looks an id up", async () => {
        wowhead.searchItems.mockResolvedValue([{ id: 900001, name: "Kapuze", icon: "inv_helmet_01", iconUrl: "u", quality: 4 }]);
        const byName = body(await get("/api/lootcouncil/manual-bis/search", { version: "forever", q: "kapu" }));
        expect(byName).toEqual({ items: [{ id: 900001, name: "Kapuze", iconUrl: "u", quality: 4 }], search: true });
        expect(wowhead.searchItems).toHaveBeenCalledWith("kapu", { path: "forever", limit: 12 });
        wowhead.lookupItem.mockResolvedValue({ id: 900002, name: "Ring", iconUrl: "r", quality: 3 });
        expect(body(await get("/api/lootcouncil/manual-bis/search", { version: "forever", q: "900002" })).items).toEqual([{ id: 900002, name: "Ring", iconUrl: "r", quality: 3 }]);
        expect(wowhead.lookupItem).toHaveBeenCalledWith(900002, { path: "forever" });
    });

    it("searches nothing without a Wowhead path, and says so", async () => {
        mockConfig = { mainVersion: "forever", versionSettings: { forever: {} } };
        expect(body(await get("/api/lootcouncil/manual-bis/search", { version: "forever", q: "kapu" }))).toEqual({ items: [], search: false });
        expect(wowhead.searchItems).not.toHaveBeenCalled();
    });
});

describe("POST /api/lootcouncil/manual-bis", () => {
    it("sets a slot: names from Wowhead of the version, an unknown item kept by id", async () => {
        mockUser = WRITER;
        wowhead.lookupItem.mockImplementation(async (id) => (id === 900001 ? { id, name: "Kapuze", icon: "inv_helmet_01", quality: 4 } : null));
        const res = await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [900001, { id: 900002, name: "Erfunden" }] });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data).toMatchObject({ spec: "Priest-Shadow", slot: 0, unresolved: [900002] });
        expect(wowhead.lookupItem).toHaveBeenCalledWith(900001, { path: "forever", strict: true });
        expect(data.lists["Priest-Shadow"].slots["0"]).toEqual([
            { id: 900001, name: "Kapuze", iconUrl: expect.stringContaining("inv_helmet_01"), quality: 4, link: "https://www.wowhead.com/forever/item=900001" },
            // the request's name is never taken
            { id: 900002, name: "", iconUrl: "", quality: null, link: "https://www.wowhead.com/forever/item=900002" },
        ]);
        expect(data.lists["Priest-Shadow"].by).toBe("Orga");
        expect(data.specs.find((s) => s.key === "Priest-Shadow").filled).toBe(1);
    });

    it("reuses a known name without asking Wowhead again, and keeps an id when Wowhead is down", async () => {
        store.setSlot("forever", "Mage-Fire", 14, [{ id: 900020, name: "Umhang", icon: "inv_misc_cape_01" }]);
        wowhead.lookupItem.mockRejectedValue(new Error("timeout"));
        const data = body(await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 14, items: [900020, 900021] }));
        expect(data.lists["Priest-Shadow"].slots["14"].map((i) => [i.id, i.name])).toEqual([[900020, "Umhang"], [900021, ""]]);
        expect(data.unresolved).toEqual([900021]);
        expect(wowhead.lookupItem).toHaveBeenCalledTimes(1);
    });

    it("stores ids alone when the version has no Wowhead path", async () => {
        mockConfig = { mainVersion: "forever", versionSettings: { forever: {} } };
        const data = body(await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [900001] }));
        expect(data.unresolved).toEqual([900001]);
        expect(wowhead.lookupItem).not.toHaveBeenCalled();
    });

    it("names only the newly added unknown ids, not the ones already in the slot", async () => {
        store.setSlot("forever", "Priest-Shadow", 0, [{ id: 900002 }]);
        const data = body(await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: ["900002", 900003] }));
        expect(data.lists["Priest-Shadow"].slots["0"].map((i) => i.id)).toEqual([900002, 900003]);
        expect(data.unresolved).toEqual([900003]);
        const again = body(await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [900003, 900002] }));
        expect(again.unresolved).toEqual([]);
    });

    it("keeps to the main version while the others are hidden (#563)", async () => {
        mockConfig = { ...FOREVER, mainVersion: "tbc", hideOtherVersions: true };
        expect(body(await get("/api/lootcouncil/manual-bis", { version: "forever" })).versionId).toBe("tbc");
        const res = await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [1] });
        expect([status(res), code(res)]).toEqual([409, "version_hidden"]);
        expect(store.listsFor("forever")).toEqual({});
    });

    it("an empty list clears the slot", async () => {
        store.setSlot("forever", "Priest-Shadow", 0, [{ id: 900001, name: "Kapuze" }]);
        const data = body(await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [] }));
        expect(data.lists).toEqual({});
    });

    it("refuses a reader, TBC, a switched-off version and bad input", async () => {
        mockUser = READER;
        expect(status(await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [1] }))).toBe(403);
        mockUser = WRITER;
        const tbc = await post("/api/lootcouncil/manual-bis", { version: "tbc", spec: "Priest-Shadow", slot: 0, items: [1] });
        expect([status(tbc), code(tbc)]).toEqual([409, "has_bis_data"]);
        mockConfig = { mainVersion: "forever", versionSettings: { forever: { disabled: ["lootCouncilBis"] } } };
        const off = await post("/api/lootcouncil/manual-bis", { version: "forever", spec: "Priest-Shadow", slot: 0, items: [1] });
        expect([status(off), code(off)]).toEqual([409, "feature_off"]);
        mockConfig = FOREVER;
        const cases = [
            [{ version: "wotlk", spec: "Priest-Shadow", slot: 0, items: [] }, "unknown_version"],
            [{ version: "forever", spec: "Priest-Bard", slot: 0, items: [] }, "unknown_spec"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 3, items: [] }, "unknown_slot"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0, items: ["x"] }, "unknown_item"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0, items: [1, 2, 3, 4] }, "too_many"],
            // not a list: never a silently cleared slot
            [{ version: "forever", spec: "Priest-Shadow", slot: 0, items: "123" }, "unknown_item"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0 }, "unknown_item"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0, items: [10000000] }, "unknown_item"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0, items: [1.5] }, "unknown_item"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0, items: [true] }, "unknown_item"],
            // null, "" or a fraction never become the head slot 0
            [{ version: "forever", spec: "Priest-Shadow", slot: null, items: [1] }, "unknown_slot"],
            [{ version: "forever", spec: "Priest-Shadow", slot: "", items: [1] }, "unknown_slot"],
            [{ version: "forever", spec: "Priest-Shadow", items: [1] }, "unknown_slot"],
            [{ version: "forever", spec: "Priest-Shadow", slot: 0.5, items: [1] }, "unknown_slot"],
        ];
        for (const [payload, expected] of cases) {
            const res = await post("/api/lootcouncil/manual-bis", payload);
            expect([status(res), code(res)]).toEqual([400, expected]);
        }
        expect(store.listsFor("forever")).toEqual({});
    });
});
