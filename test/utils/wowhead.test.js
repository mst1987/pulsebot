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

    describe("lookupItem", () => {
        it("resolves name/icon/quality by id from the tooltip endpoint", async () => {
            axios.get.mockResolvedValue({ data: { name: "Sunhawk Leggings", icon: "inv_pants_plate_07", quality: 4 } });
            expect(await wowhead.lookupItem(29991)).toEqual({
                id: 29991,
                name: "Sunhawk Leggings",
                icon: "inv_pants_plate_07",
                iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_pants_plate_07.jpg",
                quality: 4,
            });
            expect(axios.get).toHaveBeenCalledWith(
                "https://nether.wowhead.com/tooltip/item/29991",
                expect.objectContaining({ httpsAgent: expect.anything() })
            );
        });

        it("caches by id — a second lookup of the same item skips the network", async () => {
            axios.get.mockResolvedValue({ data: { name: "Girdle of Fallen Stars", icon: "inv_belt_22" } });
            await wowhead.lookupItem(30030);
            await wowhead.lookupItem(30030);
            expect(axios.get).toHaveBeenCalledTimes(1);
        });

        it("returns null without a request for a missing/zero id", async () => {
            expect(await wowhead.lookupItem(0)).toBeNull();
            expect(await wowhead.lookupItem(null)).toBeNull();
            expect(axios.get).not.toHaveBeenCalled();
        });

        it("returns null when the response has no name", async () => {
            axios.get.mockResolvedValue({ data: {} });
            expect(await wowhead.lookupItem(99901)).toBeNull();
        });

        it("returns null on a network error (best-effort)", async () => {
            axios.get.mockRejectedValue(new Error("boom"));
            expect(await wowhead.lookupItem(99902)).toBeNull();
        });
    });
});
