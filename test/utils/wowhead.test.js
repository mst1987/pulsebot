jest.mock("axios");
const axios = require("axios");
const wowhead = require("../../src/utils/wowhead");

afterEach(() => jest.clearAllMocks());

describe("utils/wowhead", () => {
    describe("branchFor / iconUrl / itemLink", () => {
        it("maps editions to Wowhead branches", () => {
            expect(wowhead.branchFor("classic")).toBe("classic");
            expect(wowhead.branchFor("tbc")).toBe("tbc");
            expect(wowhead.branchFor("wotlk")).toBe("wotlk");
            expect(wowhead.branchFor("unknown")).toBe("tbc");
        });
        it("builds icon and item urls", () => {
            expect(wowhead.iconUrl("INV_Misc_Bone_03")).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_misc_bone_03.jpg");
            expect(wowhead.iconUrl("")).toBe("");
            expect(wowhead.itemLink(28830, "tbc")).toBe("https://www.wowhead.com/tbc/item=28830");
            expect(wowhead.itemLink(0)).toBe("");
        });
    });

    describe("searchItems", () => {
        it("returns only items, normalised, capped by limit", async () => {
            axios.get.mockResolvedValue({ data: { results: [
                { type: 6, typeName: "Spell", id: 1, name: "Thunderfury (spell)" },
                { type: 3, typeName: "Item", id: 28830, name: "Dragonspine Trophy", icon: "inv_misc_bone_03", quality: 4 },
                { type: 2, typeName: "Object", id: 99, name: "Node" },
                { type: 3, typeName: "Item", id: 0, name: "bad id" },
            ] } });
            const items = await wowhead.searchItems("dragon", { edition: "tbc" });
            expect(items).toEqual([
                { id: 28830, name: "Dragonspine Trophy", icon: "inv_misc_bone_03", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_misc_bone_03.jpg", quality: 4 },
            ]);
            expect(axios.get).toHaveBeenCalledWith(
                "https://www.wowhead.com/tbc/search/suggestions-template",
                expect.objectContaining({ params: { q: "dragon" } })
            );
        });

        it("skips the request for short queries", async () => {
            expect(await wowhead.searchItems("a")).toEqual([]);
            expect(axios.get).not.toHaveBeenCalled();
        });

        it("returns [] on a network error (best-effort)", async () => {
            axios.get.mockRejectedValue(new Error("boom"));
            expect(await wowhead.searchItems("dragon")).toEqual([]);
        });
    });
});
