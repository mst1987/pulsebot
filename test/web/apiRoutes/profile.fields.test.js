// "Mein Profil", part 2 through the real router: hours per weekday, the
// professions of the page context and a character's wish items - only the
// session's own account writes, wish items only in a Loot-Council roster and
// only items the version's Wowhead knows.
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    getRealUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settingsStore"),
    getConfig: jest.fn(),
}));
jest.mock("../../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../../src/utils/loot/wowhead"),
    lookupItem: jest.fn(),
    searchItems: jest.fn(),
}));

const { body, status, routerClient } = require("../../helpers/http");
const { getUser } = require("../../../src/web/http/auth");
const { getConfig } = require("../../../src/stores/settingsStore");
const wowhead = require("../../../src/utils/loot/wowhead");
const profiles = require("../../../src/stores/raiderProfileStore");
const rosterStore = require("../../../src/stores/rosterStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { get, request } = routerClient(require("../../../src/web/apiRoutes/profile"));

const ME = { id: "100000000000000001", name: "Devihra", isAdmin: false, access: { signup: { read: true, write: true } } };
const OTHER = { id: "100000000000000002", name: "Bob", isAdmin: false, access: { signup: { read: true, write: true } } };
const CONFIG = { mainVersion: "tbc", categoryLootSystem: { catLc: "lootcouncil" }, versionSettings: { tbc: { wowheadPath: "tbc" } } };
const put = (payload) => request("PUT", "/api/profile", payload);

beforeAll(() => {
    profiles.useFile(tempStoreFile("pff-profiles.json"));
    rosterStore.useFile(tempStoreFile("pff-rosters.json"));
    const lc = rosterStore.createRoster({ name: "SSC LC", categoryId: "catLc", versionId: "tbc" });
    rosterStore.upsertMember(lc.id, ME.id, { chars: ["Borka"] });
});
afterAll(() => {
    profiles.useFile(null);
    rosterStore.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    profiles.addCharacter(ME.id, { name: "Borka", className: "Druid", source: "log", versionId: "tbc" });
    profiles.addCharacter(ME.id, { name: "Frosti", className: "Mage", source: "log", versionId: "tbc" });
    profiles.addCharacter(OTHER.id, { name: "Bobby", className: "Warrior", source: "log", versionId: "tbc" });
    getUser.mockReturnValue(ME);
    getConfig.mockReturnValue(CONFIG);
    wowhead.lookupItem.mockReset();
    wowhead.searchItems.mockReset();
});

describe("PUT /api/profile - hours per weekday", () => {
    it("saves ab HH:MM for chosen days and sends it back", async () => {
        const data = body(await put({ availability: ["mi"], availabilityFrom: { mi: "19:30", do: "20:00" } }));
        expect(data.profile.availabilityFrom).toEqual({ mi: "19:30" });
    });
});

describe("GET /api/profile - page context", () => {
    it("names each version's professions (none in a rule set yet) and the new limits", async () => {
        const data = body(await get("/api/profile"));
        expect(Object.keys(data.professionsByVersion)).toEqual(["tbc", "classic", "forever"]);
        expect(data.professionsByVersion.tbc).toEqual({ professions: [], skillMax: null });
        expect(data.limits).toMatchObject({ professions: 2, wishItems: 10, timeStep: 15 });
    });
});

describe("PUT /api/profile - wish items", () => {
    it("takes items of the version's Wowhead for a character of a Loot-Council roster", async () => {
        wowhead.lookupItem.mockResolvedValue({ id: 30236, name: "Helm of the Vanquished Champion", icon: "inv_helmet_01", quality: 4 });
        const data = body(await put({ characters: [{ key: "borka", wishItems: [{ itemId: 30236, name: "Anything" }] }] }));
        const borka = data.profile.characters.find((c) => c.key === "borka");
        expect(borka.wishItems).toEqual([expect.objectContaining({ itemId: 30236, name: "Helm of the Vanquished Champion", quality: 4 })]);
        expect(borka.wishItems[0].link).toMatch(/wowhead\.com\/tbc\/item=/);
        expect(wowhead.lookupItem).toHaveBeenCalledWith(30236, { path: "tbc" });
    });

    it("refuses a character outside a Loot-Council roster, an unknown item and more than ten", async () => {
        const notLc = await put({ characters: [{ key: "frosti", wishItems: [1] }] });
        expect(status(notLc)).toBe(403);
        wowhead.lookupItem.mockResolvedValue(null);
        expect(status(await put({ characters: [{ key: "borka", wishItems: [99] }] }))).toBe(400);
        expect(status(await put({ characters: [{ key: "borka", wishItems: Array.from({ length: 11 }, (_, i) => i + 1) }] }))).toBe(400);
        expect(profiles.getProfile(ME.id).characters.every((c) => c.wishItems.length === 0)).toBe(true);
    });

    it("lets a raider empty the list everywhere, and never reaches another account's character", async () => {
        expect(status(await put({ characters: [{ key: "frosti", wishItems: [] }] }))).toBe(200);
        await put({ characters: [{ key: "bobby", wishItems: [1] }] });
        expect(profiles.getProfile(OTHER.id).characters[0].wishItems).toEqual([]);
        expect(wowhead.lookupItem).not.toHaveBeenCalled();
    });
});

describe("GET /api/profile/item-search", () => {
    it("searches the version's Wowhead for signed-up members", async () => {
        wowhead.searchItems.mockResolvedValue([{ id: 1, name: "Helm" }]);
        expect(body(await get("/api/profile/item-search", { q: "Helm", version: "tbc" })).items).toEqual([{ id: 1, name: "Helm" }]);
        expect(wowhead.searchItems).toHaveBeenCalledWith("Helm", { path: "tbc", limit: 12 });
        getUser.mockReturnValue({ id: "3", name: "Lo", isAdmin: false, access: { loot: { read: true, write: false } } });
        expect(status(await get("/api/profile/item-search", { q: "Helm" }))).toBe(403);
    });
});
