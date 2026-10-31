jest.mock("axios");
const axios = require("axios");
const wowhead = require("../../../src/utils/loot/wowhead");

afterEach(() => jest.clearAllMocks());

describe("utils/loot/wowhead", () => {
    describe("branchFor / iconUrl / itemLink", () => {
        it("maps editions to Wowhead branches", () => {
            expect(wowhead.branchFor("classic")).toBe("classic");
            expect(wowhead.branchFor("tbc")).toBe("tbc");
            expect(wowhead.branchFor("wotlk")).toBe("wotlk");
            expect(wowhead.branchFor("unknown")).toBe("tbc");
            // a version's own Wowhead path (#542) wins over the edition
            expect(wowhead.branchFor("tbc", "forever")).toBe("forever");
            expect(wowhead.itemLink(28830, "tbc", "classic")).toBe("https://www.wowhead.com/classic/item=28830");
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

        it("searches the Wowhead path of a version when one is handed in (#542)", async () => {
            axios.get.mockResolvedValue({ data: { results: [] } });
            await wowhead.searchItems("onyxia", { path: "classic" });
            expect(axios.get).toHaveBeenCalledWith("https://www.wowhead.com/classic/search/suggestions-template", expect.any(Object));
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

    describe("lookupItem strict", () => {
        it("stays null for an unknown item, but throws when Wowhead does not answer", async () => {
            const notFound = Object.assign(new Error("404"), { response: { status: 404 } });
            axios.get.mockRejectedValueOnce(notFound);
            expect(await wowhead.lookupItem(990001, { path: "tbc", strict: true })).toBeNull();
            axios.get.mockRejectedValueOnce(new Error("timeout"));
            await expect(wowhead.lookupItem(990002, { path: "tbc", strict: true })).rejects.toThrow("timeout");
            // without strict a failure is just "not found", as ever
            axios.get.mockRejectedValueOnce(new Error("timeout"));
            expect(await wowhead.lookupItem(990003, { path: "tbc" })).toBeNull();
        });
    });

    describe("lookupItemDetails", () => {
        const XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><wowhead><item id=\"22854\"><name><![CDATA[Flask of Relentless Assault]]></name>"
            + "<level>75</level><quality id=\"1\">Common</quality><class id=\"0\"><![CDATA[Consumables]]></class>"
            + "<subclass id=\"3\"><![CDATA[Flasks]]></subclass><icon displayId=\"0\">inv_potion_117</icon></item></wowhead>";

        it("reads the English item XML with class and subclass by default", async () => {
            axios.get.mockResolvedValue({ data: XML });
            expect(await wowhead.lookupItemDetails(22854, { path: "tbc" })).toEqual({
                id: 22854,
                name: "Flask of Relentless Assault",
                icon: "inv_potion_117",
                iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_potion_117.jpg",
                quality: 1,
                classId: 0,
                subclassId: 3,
                className: "Consumables",
                subclassName: "Flasks",
            });
            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(axios.get.mock.calls[0][0]).toBe("https://www.wowhead.com/tbc/item=22854&xml");
        });

        it("asks the German page with its locale segment when asked for German", async () => {
            axios.get.mockResolvedValue({ data: XML });
            await wowhead.lookupItemDetails(22854, { path: "classic", locale: "de" });
            expect(axios.get.mock.calls[0][0]).toBe("https://www.wowhead.com/classic/de/item=22854&xml");
        });

        it("falls back to the tooltip when the XML has no item (German: locale 3)", async () => {
            axios.get
                .mockResolvedValueOnce({ data: "<wowhead><error>Item not found!</error></wowhead>" })
                .mockResolvedValueOnce({ data: { name: "Netherstoff", icon: "inv_fabric_netherweave", quality: 1 } });
            expect(await wowhead.lookupItemDetails(21877, { locale: "de" })).toMatchObject({
                id: 21877, name: "Netherstoff", icon: "inv_fabric_netherweave", quality: 1, classId: null, className: "",
            });
            expect(axios.get.mock.calls[1][0]).toBe("https://nether.wowhead.com/tbc/tooltip/item/21877?locale=3");
        });

        it("falls back when the XML request fails, and gives null when both fail", async () => {
            axios.get
                .mockRejectedValueOnce(new Error("blocked"))
                .mockResolvedValueOnce({ data: { name: "Netherweave Cloth", icon: "" } });
            expect(await wowhead.lookupItemDetails(21877)).toMatchObject({ name: "Netherweave Cloth", iconUrl: "", quality: null });
            expect(axios.get.mock.calls[1][0]).toBe("https://nether.wowhead.com/tbc/tooltip/item/21877");

            axios.get.mockRejectedValueOnce(new Error("blocked")).mockRejectedValueOnce(new Error("404"));
            expect(await wowhead.lookupItemDetails(999999)).toBeNull();
            axios.get.mockResolvedValueOnce({ data: "" }).mockResolvedValueOnce({ data: { error: "x" } });
            expect(await wowhead.lookupItemDetails(999998)).toBeNull();
            expect(await wowhead.lookupItemDetails(0)).toBeNull();
        });
    });

    describe("Forever's own section (#750)", () => {
        it("looks items up and builds links on /forever", async () => {
            axios.get.mockResolvedValue({ data: { name: "Test Item", icon: "inv_misc_bone_03", quality: 4 } });
            await wowhead.lookupItem(1234, { path: "forever" });
            expect(axios.get).toHaveBeenCalledWith("https://nether.wowhead.com/forever/tooltip/item/1234", expect.anything());
            expect(wowhead.itemLink(1234, "tbc", "forever")).toBe("https://www.wowhead.com/forever/item=1234");
        });

        it("keeps the name cache apart per path", async () => {
            axios.get.mockResolvedValue({ data: { results: [{ typeName: "Item", id: 9, name: "Gemname", icon: "x", quality: 3 }] } });
            expect((await wowhead.findItemByName("Gemname", { path: "forever" })).id).toBe(9);
            expect(axios.get).toHaveBeenCalledWith("https://www.wowhead.com/forever/search/suggestions-template", expect.anything());
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
            // On the TBC branch, not the branchless endpoint: retail answers
            // with retail's data, where the era's relics and idols are quality 0.
            expect(axios.get).toHaveBeenCalledWith(
                "https://nether.wowhead.com/tbc/tooltip/item/29991",
                expect.objectContaining({ httpsAgent: expect.anything() })
            );
        });

        it("asks the branch of the edition it is given", async () => {
            axios.get.mockResolvedValue({ data: { name: "Frostmourne", icon: "inv_sword_82", quality: 5 } });
            await wowhead.lookupItem(49623, { edition: "wotlk" });
            expect(axios.get).toHaveBeenCalledWith(
                "https://nether.wowhead.com/wotlk/tooltip/item/49623",
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

    // TBC Anniversary re-issues Wowhead does not know (config/data/wowheadItemAliases.js).
    describe("Anniversary re-issues", () => {
        it("links the original item Wowhead knows", () => {
            expect(wowhead.itemLink(281895)).toBe("https://www.wowhead.com/tbc/item=37127");
        });

        it("looks the original up but keeps the re-issue's id", async () => {
            axios.get.mockResolvedValue({ data: { name: "Brightbrew Charm", icon: "inv_misc_orb_01", quality: 4 } });
            const item = await wowhead.lookupItem(281895);
            expect(axios.get.mock.calls[0][0]).toBe("https://nether.wowhead.com/tbc/tooltip/item/37127");
            expect(item).toMatchObject({ id: 281895, name: "Brightbrew Charm" });
        });
    });
});
