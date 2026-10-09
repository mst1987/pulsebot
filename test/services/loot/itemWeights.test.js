// What one award counts as (#668), against the real generated tables: the
// class rules in their order, the per-item exception and the loot points.
const { itemFacts, itemClass, itemWeight, lootPoints } = require("../../../src/services/loot/itemWeights");
const councilWeights = require("../../../src/stores/councilWeightsStore");
const wowsims = require("../../../src/config/wowsims");

const S = councilWeights.defaults();

describe("services/loot/itemWeights", () => {
    it("knows a trinket by its slot", () => {
        expect(itemFacts(28789)).toMatchObject({ trinket: true, weapon: false, name: "Eye of Magtheridon" });
        expect(itemWeight(28789, S)).toEqual({ weight: 2, cls: "trinket" });
    });

    it("tells a BiS weapon (on the recipient's list) from any other weapon", () => {
        const bisIds = new Set(wowsims.bisFor("Priest-Shadow", "t6").items.map((b) => Number(b.id)));
        expect(bisIds.has(32374)).toBe(true);
        expect(itemWeight(32374, S, { bisIds })).toEqual({ weight: 2, cls: "bisWeapon" });
        expect(itemWeight(32374, S)).toEqual({ weight: 1.5, cls: "weapon" });
        expect(itemWeight(30910, S, { bisIds })).toEqual({ weight: 1.5, cls: "weapon" });
    });

    it("does not count a shield, an off-hand or a relic as a weapon", () => {
        const shield = Object.entries(require("../../../src/config/generated/wowsims/items.json").items)
            .find(([, it]) => it.hand === "off" && !it.weapon);
        expect(shield).toBeTruthy();
        expect(itemFacts(Number(shield[0])).weapon).toBe(false);
    });

    it("finds set pieces by their set and tier tokens by name", () => {
        expect(itemFacts(31064).set).toBe(true); // Hood of Absolution
        expect(itemWeight(31097, S)).toEqual({ weight: 1, cls: "set" }); // Helm of the Forgotten Conqueror
        // a token only a loot row names (German client): matched by the name it carries
        expect(itemClass(0, S, { itemName: "Helm des vergessenen Eroberers" })).toBe("set");
        expect(itemFacts(29982).set).toBe(false); // Wand of the Forgotten Star: no class word
    });

    it("counts trash and timed-chest drops as frequent, before every other class", () => {
        expect(itemWeight(30021, S)).toEqual({ weight: 0.5, cls: "frequent" }); // SSC trash staff
        expect(itemClass(33490, S)).toBe("frequent"); // Zul'Aman timed chest
    });

    it("calls everything else normal, including items no table knows", () => {
        expect(itemWeight(999999, S)).toEqual({ weight: 1, cls: "normal" });
        expect(itemClass(28793, S)).not.toBe("override");
    });

    it("lets an exception for the exact item beat every rule", () => {
        const settings = { ...S, items: { 30021: { weight: 1.8, name: "" } } };
        expect(itemWeight(30021, settings)).toEqual({ weight: 1.8, cls: "override" });
    });

    it("uses the council's class weights", () => {
        const settings = { ...S, classes: { ...S.classes, trinket: 3.5 } };
        expect(itemWeight(28789, settings).weight).toBe(3.5);
        expect(itemWeight(28789, { items: {} }).weight).toBe(1);
    });

    it("adds the weights of a list up to its loot points", () => {
        expect(lootPoints([{ itemId: 28789 }, { itemId: 31064 }, { itemId: 30021 }], S)).toBe(3.5);
        expect(lootPoints([], S)).toBe(0);
    });
});
