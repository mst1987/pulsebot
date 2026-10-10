// /council links the item on the Wowhead section of the channel's category (#750).
jest.mock("../../../src/stores/configStore", () => ({ getConfig: jest.fn() }));
const { getConfig } = require("../../../src/stores/configStore");
const { itemLinkFor } = require("../../../src/commands/lookup/council");

beforeEach(() => {
    getConfig.mockReturnValue({
        mainVersion: "tbc",
        categoryVersion: { fv: "forever" },
        versionSettings: { tbc: { wowheadPath: "tbc" }, forever: { wowheadPath: "forever" } },
    });
});

describe("commands/lookup/council itemLinkFor", () => {
    it("uses the version of the channel's category", () => {
        expect(itemLinkFor(32837, { parentId: "fv" })).toBe("https://www.wowhead.com/forever/item=32837");
    });

    it("falls back to the main version for a channel without a category or without a channel", () => {
        expect(itemLinkFor(32837, { parentId: "other" })).toBe("https://www.wowhead.com/tbc/item=32837");
        expect(itemLinkFor(32837, null)).toBe("https://www.wowhead.com/tbc/item=32837");
    });

    it("reads the category of a thread's parent channel", () => {
        expect(itemLinkFor(1, { isThread: () => true, parentId: "textchannel", parent: { parentId: "fv" } })).toBe("https://www.wowhead.com/forever/item=1");
    });
});
