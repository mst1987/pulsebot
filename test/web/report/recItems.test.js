// The items behind a raider's gear finding (src/web/report/recItems.js): issues
// joined with the armory, grouped per item and problem, as lines and as the
// small icons of the card head.
const { QUALITY_COLOR, wowheadItemUrl, gearItemsOf, itemCount, itemRows, miniIcons, problemText } = require("../../../src/web/report/recItems");

const armory = [
    { slot: 2, slotName: "Schultern", itemId: "28726", itemName: "Mantle of the Mind Flayer", icon: "inv_shoulder_67", quality: 4, gems: [], enchant: { status: "missing", enchantId: null } },
    { slot: 8, slotName: "Handgelenke", itemId: "24250", itemName: "Bracers of Havok", icon: "inv_bracer_13", quality: 3, gems: [], enchant: { status: "ok", enchantId: "2650" } },
    { slot: 6, slotName: "Beine", itemId: "30107", itemName: "Leggings of the Avatar", icon: "inv_pants_cloth_19", quality: 4,
        gems: [{ id: "24030", icon: "inv_jewelcrafting_gem_14", bad: false }, { id: "23117", icon: "inv_misc_gem_bloodgem_02", bad: true }], enchant: { status: "ok", enchantId: "2748" } },
];
const issues = [
    { kind: "noEnchant", itemId: "28726", itemName: "Mantle of the Mind Flayer", icon: "inv_shoulder_67", slot: 2, label: "keine Verzauberung", severity: "high" },
    { kind: "emptySocket", itemId: "24250", itemName: "Bracers of Havok", icon: "inv_bracer_13", slot: 8, label: "leerer Sockel", severity: "medium" },
    { kind: "emptySocket", itemId: "24250", itemName: "Bracers of Havok", icon: "inv_bracer_13", slot: 8, label: "leerer Sockel", severity: "medium" },
    { kind: "badGem", itemId: "30107", itemName: "Leggings of the Avatar", icon: "inv_pants_cloth_19", slot: 6, label: "grüner Edelstein", severity: "medium" },
    { kind: "noItem", itemId: null, itemName: "Hals", icon: null, slot: 1, label: "kein Item", severity: "high" },
];
const p = { name: "Devire", type: "Mage", armory, issues };

describe("web/report/recItems", () => {
    describe("gearItemsOf", () => {
        it("joins the issues with the armory and counts a repeated problem once", () => {
            const items = gearItemsOf(p);
            expect(items.map((it) => [it.itemName, it.kind, it.count])).toEqual([
                ["Mantle of the Mind Flayer", "noEnchant", 1],
                ["Bracers of Havok", "emptySocket", 2],
                ["Leggings of the Avatar", "badGem", 1],
                ["Hals", "noItem", 1],
            ]);
            expect(items[0]).toMatchObject({ itemId: "28726", quality: 4, slotName: "Schultern", severity: "high", icon: "inv_shoulder_67" });
            expect(items[1]).toMatchObject({ quality: 3, severity: "medium", slotName: "Handgelenke" });
            // the gem in question: the flagged one
            expect(items[2].gemIcon).toBe("inv_misc_gem_bloodgem_02");
            // an empty slot has no item, no slot line and no link
            expect(items[3]).toMatchObject({ itemId: null, slotName: "", href: "", icon: null });
            // the link carries enchant and gems for the Wowhead tooltip
            expect(items[1].href).toContain("24250");
            expect(items[1].href).toContain("ench=2650");
            expect(items[2].href).toContain("gems=24030:23117");
        });

        it("takes the issues it is given and works without an armory (older reports)", () => {
            const items = gearItemsOf({ name: "A" }, [{ itemId: 1, itemName: "Hood", icon: "inv_helmet", severity: "medium", label: "keine Verzauberung" }]);
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({ itemId: "1", itemName: "Hood", quality: undefined, slotName: "", severity: "medium" });
            expect(items[0].href).toContain("1");
            expect(gearItemsOf(null)).toEqual([]);
        });
    });

    it("counts different items, a slot without an item as one", () => {
        expect(itemCount(gearItemsOf(p))).toBe(4);
        expect(itemCount([])).toBe(0);
    });

    it("says the problem with a capital and the count", () => {
        expect(problemText({ label: "leerer Sockel", count: 2 })).toBe("2× Leerer Sockel");
        expect(problemText({ label: "keine Verzauberung", count: 1 })).toBe("Keine Verzauberung");
        expect(problemText({ label: "", count: 1 })).toBe("Problem");
    });

    describe("itemRows", () => {
        const html = itemRows(gearItemsOf(p));

        it("draws icon with quality frame and mark, name, slot and the problem", () => {
            expect(html).toContain(`<a class="ri-icon" style="--q:${QUALITY_COLOR[4]}" href="`);
            expect(html).toContain("inv_shoulder_67.jpg\" loading=\"lazy\" alt=\"\"><span class=\"ri-mark bad\" aria-hidden=\"true\">✕</span></a>");
            expect(html).toContain(">Mantle of the Mind Flayer</a><span class=\"ri-slot\">Schultern</span>");
            expect(html).toContain("<span class=\"ri-prob bad\" data-tip=\"Keine Verzauberung\" data-tip-sub=\"Der Slot lässt sich verzaubern, trägt aber nichts.\"><img src=\"https://wow.zamimg.com/images/wow/icons/large/trade_engraving.jpg\"");
            // a weak point: the ! mark, the socket as a dashed ring, the gem's own icon
            expect(html).toContain("<span class=\"ri-mark mid\" aria-hidden=\"true\">!</span>");
            expect(html).toContain("<span class=\"ri-sock\" aria-hidden=\"true\"></span>2× Leerer Sockel</span>");
            expect(html).toContain("inv_misc_gem_bloodgem_02.jpg\" loading=\"lazy\" alt=\"\">Grüner Edelstein</span>");
        });

        it("draws an empty slot without link and without icon", () => {
            expect(html).toContain("<span class=\"ri-icon\" style=\"--q:var(--line)\"><span class=\"ri-none\"></span><span class=\"ri-mark bad\" aria-hidden=\"true\">✕</span></span>");
            expect(html).toContain("<span class=\"ri-name\" style=\"--q:var(--line)\">Hals</span></span>");
        });

        it("escapes names", () => {
            const out = itemRows(gearItemsOf({ issues: [{ itemId: "9", itemName: "<b>", icon: "x", label: "<i>", severity: "high" }] }));
            expect(out).toContain("&lt;b&gt;");
            expect(out).not.toContain("<b>");
            expect(out).toContain("&lt;i&gt;");
        });
    });

    describe("miniIcons", () => {
        it("shows up to three items, each once with all its problems in the tooltip", () => {
            const html = miniIcons(gearItemsOf(p));
            expect(html.match(/<img class="mini"/g)).toHaveLength(3);
            expect(html).toContain("data-tip=\"Bracers of Havok\" data-tip-sub=\"2× Leerer Sockel\"");
            expect(html).not.toContain("Hals");
            const both = miniIcons(gearItemsOf({ issues: [
                { itemId: "1", itemName: "Hood", icon: "a", label: "keine Verzauberung", kind: "noEnchant", severity: "high" },
                { itemId: "1", itemName: "Hood", icon: "a", label: "leerer Sockel", kind: "emptySocket", severity: "medium" },
            ] }));
            expect(both.match(/<img class="mini"/g)).toHaveLength(1);
            expect(both).toContain("data-tip-sub=\"Keine Verzauberung · Leerer Sockel\"");
        });

        it("is empty without items", () => {
            expect(miniIcons([])).toBe("");
        });
    });

    it("builds the Wowhead link with enchant and gems", () => {
        expect(wowheadItemUrl({ itemId: "5", enchant: { enchantId: "7" }, gems: [{ id: "8" }, { id: "9" }] })).toMatch(/item=5.*ench=7.*gems=8:9/);
    });
});
