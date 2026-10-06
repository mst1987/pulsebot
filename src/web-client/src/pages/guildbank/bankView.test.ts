import { describe, expect, it } from "vitest";
import { availableTone, groupItems, groupNames, itemName, itemsInTab, listedItems, tabCounts, tabLine, wholeNumber } from "./bankView";
import { bankData, bankItem } from "./guildBank.fixture";

const items = () => bankData().bank!.items;

describe("guild bank page rules", () => {
    it("leaves out items whose whole stock lies in hidden tabs, and counts the rest per tab", () => {
        expect(listedItems(items()).map((i) => i.itemId)).not.toContain(7);
        expect(tabCounts(items())).toEqual({ give: 3, show: 1, hide: 1, new: 1 });
    });

    it("groups a tab's items by category, sorted, with search and category filter", () => {
        const groups = groupItems(items(), { tab: "give", category: "", search: "" });
        expect(groups.map((g) => [g.name, g.items.map((i) => i.itemId)])).toEqual([
            ["Edelsteine", [2, 1]],
            ["Fläschchen", [3]],
        ]);
        expect(groupItems(items(), { tab: "give", category: "Fläschchen", search: "" }).map((g) => g.name)).toEqual(["Fläschchen"]);
        expect(groupItems(items(), { tab: "give", category: "", search: "  rubin " })[0].items.map((i) => i.itemId)).toEqual([1]);
        expect(groupItems(items(), { tab: "give", category: "", search: "nichts" })).toEqual([]);
    });

    it("puts items without a group under Sonstiges, last", () => {
        const list = [bankItem({ itemId: 1, group: "" }), bankItem({ itemId: 2, group: "Zeug" })];
        expect(groupNames(list)).toEqual(["Zeug", "Sonstiges"]);
        expect(groupItems(list, { tab: "give", category: "Sonstiges", search: "" })[0].items.map((i) => i.itemId)).toEqual([1]);
    });

    it("names an item Wowhead has not answered for by its id", () => {
        expect(itemName(bankItem({ name: "", itemId: 22854 }))).toBe("Gegenstand 22854");
    });

    it("colours Verfügbar: nothing left is bad, a few is mid", () => {
        expect([availableTone(0), availableTone(3), availableTone(4)]).toEqual(["bad", "mid", "ok"]);
    });

    it("writes the bank tabs an item lies in, or that it left the bank", () => {
        const tabs = bankData().bank!.tabs;
        expect(tabLine(bankItem({ tabs: { 3: 1, 2: 4 } }), tabs)).toBe("Tab 2: Edelsteine · Tab 3: Raid");
        expect(tabLine(bankItem({ tabs: { 9: 1 } }), tabs)).toBe("Tab 9");
        expect(tabLine(bankItem({ tabs: {} }), tabs)).toBe("Nicht mehr in der Bank");
    });

    it("counts the items of a tab, hidden ones included", () => {
        expect(itemsInTab(items(), 5)).toBe(1);
        expect(itemsInTab(items(), 3)).toBe(2);
    });

    it("reads whole numbers from 0 only", () => {
        expect([wholeNumber(" 12 "), wholeNumber("0"), wholeNumber("-1"), wholeNumber("1.5"), wholeNumber("")]).toEqual([12, 0, null, null, null]);
    });
});
