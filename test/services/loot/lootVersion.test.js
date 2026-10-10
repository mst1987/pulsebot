// Imported loot links the Wowhead of its event's version (#542): an own event's
// own version, else the category's.
jest.mock("../../../src/stores/eventStore", () => ({ getEvent: jest.fn(() => null) }));
jest.mock("../../../src/stores/configStore", () => ({ getConfig: jest.fn(() => ({})) }));

const { getEvent } = require("../../../src/stores/eventStore");
const { getConfig } = require("../../../src/stores/configStore");
jest.mock("../../../src/utils/loot/wowhead");
const wowhead = require("../../../src/utils/loot/wowhead");
const { versionOfImport, relinkItems, linkItemsForImport, enrichForImport } = require("../../../src/services/loot/lootVersion");

const CONFIG = {
    mainVersion: "tbc",
    categoryVersion: { fv: "forever" },
    versionSettings: { tbc: { wowheadPath: "tbc" }, forever: { wowheadPath: "" }, classic: { wowheadPath: "classic" } },
};

beforeEach(() => {
    getConfig.mockReturnValue(CONFIG);
    getEvent.mockReturnValue(null);
});

describe("services/loot/lootVersion", () => {
    it("looks names up in the Wowhead section of the target's version (#750)", async () => {
        wowhead.lookupItem.mockResolvedValue(null);
        getConfig.mockReturnValue({ ...CONFIG, versionSettings: { ...CONFIG.versionSettings, forever: { wowheadPath: "forever" } } });
        await enrichForImport([{ itemId: 5, itemName: "", itemIconUrl: "" }], { categoryId: "fv" });
        expect(wowhead.lookupItem).toHaveBeenCalledWith(5, { path: "forever" });
        wowhead.lookupItem.mockClear();
        await enrichForImport([{ itemId: 6, itemName: "", itemIconUrl: "" }], {});
        expect(wowhead.lookupItem).toHaveBeenCalledWith(6, { path: "tbc" });
    });

    it("takes an own event's version, else the category's, else the main version", () => {
        getEvent.mockReturnValueOnce({ id: "eh-1", versionId: "classic", categoryId: "fv" });
        expect(versionOfImport({ eventId: "eh-1", categoryId: "x" })).toBe("classic");
        expect(versionOfImport({ eventId: "rh-1", categoryId: "fv" })).toBe("forever");
        expect(versionOfImport({})).toBe("tbc");
    });

    it("relinks every item with that version's Wowhead path, and leaves the link out without one", () => {
        const items = [{ itemId: 32837, itemLink: "old" }, { itemId: 0, itemLink: "" }, null];
        relinkItems(items, "classic");
        expect(items[0].itemLink).toBe("https://www.wowhead.com/classic/item=32837");
        expect(items[1].itemLink).toBe("");
        linkItemsForImport(items, { eventId: "rh-1", categoryId: "fv" });
        expect(items[0].itemLink).toBe("");
        linkItemsForImport(items, { categoryId: "other" });
        expect(items[0].itemLink).toBe("https://www.wowhead.com/tbc/item=32837");
    });
});
