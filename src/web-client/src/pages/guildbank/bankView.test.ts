import { describe, expect, it } from "vitest";
import {
    availableTone, groupItems, groupNames, groupWaitlist, isDirectItemInput, itemName, itemsInTab, listedItems, tabCounts, tabLine, waitingName, waitingTotal, waitlistItems, wholeNumber,
} from "./bankView";
import type { GuildBankWaitingEntry } from "../../api";
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
            ["Edelsteine", [1, 2]],
            ["Fläschchen", [3]],
        ]);
        expect(groupItems(items(), { tab: "give", category: "Fläschchen", search: "" }).map((g) => g.name)).toEqual(["Fläschchen"]);
        expect(groupItems(items(), { tab: "give", category: "", search: "  ruby " })[0].items.map((i) => i.itemId)).toEqual([1]);
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

    it("tells an item id or Wowhead link from a name to search for", () => {
        expect(isDirectItemInput("32227")).toBe(true);
        expect(isDirectItemInput(" https://www.wowhead.com/tbc/item=32227/crimson-spinel ")).toBe(true);
        expect(isDirectItemInput("item=32227")).toBe(true);
        expect(isDirectItemInput("Crimson Spinel")).toBe(false);
        expect(isDirectItemInput("https://example.com/item=5")).toBe(false);
    });

    it("writes the bank tabs an item lies in, or that it left the bank", () => {
        const tabs = bankData().bank!.tabs;
        expect(tabLine(bankItem({ tabs: { 3: 1, 2: 4 } }), tabs)).toBe("Tab 2: Edelsteine · Tab 3: Raid");
        expect(tabLine(bankItem({ tabs: { 9: 1 } }), tabs)).toBe("Tab 9");
        expect(tabLine(bankItem({ tabs: {} }), tabs)).toBe("Nicht in der Bank");
    });

    it("counts the items of a tab, hidden ones included", () => {
        expect(itemsInTab(items(), 5)).toBe(1);
        expect(itemsInTab(items(), 3)).toBe(2);
    });

    it("reads whole numbers from 0 only", () => {
        expect([wholeNumber(" 12 "), wholeNumber("0"), wholeNumber("-1"), wholeNumber("1.5"), wholeNumber("")]).toEqual([12, 0, null, null, null]);
    });

    describe("the waiting list (#775)", () => {
        const entry = (over: Partial<GuildBankWaitingEntry>): GuildBankWaitingEntry => ({
            id: "w", itemId: 1, item: "Ruby", iconUrl: "", amount: 1, userId: "u", userName: "Anna", characterName: "Zibbo",
            realm: "", purpose: "", createdAt: 1, position: 1, addedByName: "", ...over,
        });

        it("counts who waits over the listed items only", () => {
            const list = [bankItem({ itemId: 1, waiting: 2 }), bankItem({ itemId: 2, waiting: 1 }), bankItem({ itemId: 3, waiting: 5, tabHidden: true })];
            expect(waitingTotal(list)).toBe(3);
            expect(waitingTotal([])).toBe(0);
        });

        it("groups the entries per item, items by name, places in order", () => {
            const groups = groupWaitlist([
                entry({ id: "a", itemId: 2, item: "Spinal", position: 2 }), entry({ id: "b", itemId: 2, item: "Spinal", position: 1 }), entry({ id: "c", itemId: 1, item: "Pyrestone" }),
            ]);
            expect(groups.map((g) => [g.item, g.entries.map((e) => e.id)])).toEqual([["Pyrestone", ["c"]], ["Spinal", ["b", "a"]]]);
        });

        it("names the raider, else the character, and offers only the items on 'give'", () => {
            expect(waitingName(entry({}))).toBe("Anna");
            expect(waitingName(entry({ userName: "", userId: "" }))).toBe("Zibbo");
            expect(waitlistItems(items()).map((i) => i.itemId)).toEqual([1, 3, 2]);
        });
    });
});
