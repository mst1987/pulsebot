const { lootCatalog, itemsForContent, suggestedContents } = require("../../src/web/lootCatalog");
const { CONTENTS, RAID_LOOT } = require("../../src/config/tbcContent");

describe("web/lootCatalog", () => {
    describe("itemsForContent", () => {
        it("lists every drop of a raid, named and with an icon", () => {
            const items = itemsForContent("ssc");
            const ids = new Set(Object.values(RAID_LOOT.ssc).flat());
            expect(items).toHaveLength(ids.size);
            for (const it of items) expect(ids.has(it.id)).toBe(true);
            // One of Leotheras' drops, as the picker renders it.
            const fang = items.find((it) => it.id === 30095);
            expect(fang).toMatchObject({ name: "Fang of the Leviathan", boss: "Leotheras the Blind", quality: 4 });
            expect(fang.iconUrl).toMatch(/^https:\/\/wow\.zamimg\.com\//);
            expect(fang.itemLink).toContain("item=30095");
        });

        it("puts the encounters first and Trash/nameless drops last", () => {
            const bosses = [];
            for (const it of itemsForContent("kara")) if (!bosses.includes(it.boss)) bosses.push(it.boss);
            expect(bosses[0]).not.toBe("Trash");
            expect(bosses[bosses.length - 1]).toBe("Trash");
        });

        it("is empty for a raid the table doesn't know", () => {
            expect(itemsForContent("naxx")).toEqual([]);
            expect(itemsForContent("")).toEqual([]);
        });
    });

    describe("lootCatalog", () => {
        it("covers every content, in CONTENTS order, with its tier label", () => {
            const cat = lootCatalog();
            expect(cat.map((c) => c.id)).toEqual(CONTENTS.map((c) => c.id));
            expect(cat.find((c) => c.id === "swp")).toMatchObject({ tier: "t65", tierLabel: "Sunwell" });
            for (const c of cat) expect(c.items.length).toBeGreaterThan(0);
        });

        it("names every item it offers", () => {
            // A picker entry with no name is unusable — it would read "Item
            // 30095" and be unfindable by search.
            const unnamed = lootCatalog().flatMap((c) => c.items).filter((it) => /^Item \d+$/.test(it.name));
            expect(unnamed).toEqual([]);
        });
    });

    describe("suggestedContents", () => {
        it("takes the raids from the loot already stored for the event", () => {
            const items = [{ contentId: "tk" }, { contentId: "ssc" }, { contentId: "" }];
            // In CONTENTS order, not in the order the rows happened to arrive.
            expect(suggestedContents({ title: "Hyjal", items })).toEqual(["ssc", "tk"]);
        });

        it("falls back to the event title when no loot is stored yet", () => {
            expect(suggestedContents({ title: "SSC/TK Donnerstag", items: [] })).toEqual(["ssc", "tk"]);
        });

        it("suggests nothing when neither says anything", () => {
            expect(suggestedContents({ title: "Raidabend", items: [] })).toEqual([]);
            expect(suggestedContents()).toEqual([]);
        });
    });
});
