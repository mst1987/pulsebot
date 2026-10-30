import { describe, expect, it } from "vitest";
import {
    availableTone, filterWaitlist, groupItems, groupNames, groupWaitlist, isDirectItemInput, itemName, itemsInTab, listedItems, tabCounts, tabLine, waitingName, waitingTotal, waitlistItems, wholeNumber, validPortion, PORTION_MAX, dayLabel, filterHandedOut, groupHandedOutByDay, itemTabOf, recipientName,
} from "../bankView";
import type { GuildBankHandedOut, GuildBankWaitingEntry } from "../../../api";
import { bankData, bankItem } from "../guildBank.fixture";

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

    it("takes a portion per turn from 1 to 99", () => {
        expect([1, 2, PORTION_MAX, 0, 100, 1.5, Number.NaN].map(validPortion)).toEqual([true, true, true, false, false, false, false]);
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

describe("waiting list filter", () => {
    const e = (over: Partial<GuildBankWaitingEntry>): GuildBankWaitingEntry => ({
        id: "w", itemId: 1, item: "Bold Living Ruby", iconUrl: "", amount: 1, userId: "u", userName: "Anna", characterName: "Zibbo",
        realm: "", purpose: "", createdAt: 0, position: 1, addedByName: "", ...over,
    });
    const entries = [e({ id: "a" }), e({ id: "b", itemId: 2, item: "Smooth Dawnstone", userName: "Bo", characterName: "Bo" })];
    const byId = new Map(items().map((it) => [it.itemId, it]));

    it("lets everything through without a filter and finds by item, player or character", () => {
        expect(filterWaitlist(entries, byId, { category: "", search: "" })).toHaveLength(2);
        expect(filterWaitlist(entries, byId, { category: "", search: "dawn" }).map((x) => x.id)).toEqual(["b"]);
        expect(filterWaitlist(entries, byId, { category: "", search: "anna" }).map((x) => x.id)).toEqual(["a"]);
        expect(filterWaitlist(entries, byId, { category: "", search: "zibbo" }).map((x) => x.id)).toEqual(["a"]);
    });

    it("filters by the item's category", () => {
        const group = byId.get(2) ? groupNames(items()).find((g) => g === (byId.get(2)!.group || "Sonstiges")) || "" : "";
        const out = filterWaitlist(entries, byId, { category: group, search: "" });
        expect(out.every((x) => x.itemId === 2 || byId.get(x.itemId)!.group === byId.get(2)!.group)).toBe(true);
        expect(filterWaitlist(entries, byId, { category: "Nichts", search: "" })).toEqual([]);
    });
});

describe("handed out (Ausgegeben)", () => {
    const at = (iso: string) => Date.parse(iso);
    const out = (over: Partial<GuildBankHandedOut>): GuildBankHandedOut => ({
        id: "h", itemId: 1, item: "Bold Living Ruby", iconUrl: "", amount: 1, userId: "u1", userName: "Anna", characterName: "Zibbo", realm: "",
        purpose: "", createdAt: 0, confirmedByName: "", handedOutAt: 0, handedOutByName: "", handoutVia: "manual", fromWaitlist: false, ...over,
    });

    it("maps the extra tabs onto the offered items", () => {
        expect(itemTabOf("wait")).toBe("give");
        expect(itemTabOf("out")).toBe("give");
        expect(itemTabOf("show")).toBe("show");
    });

    it("names the recipient Name-Realm without spaces, the name alone, or nothing", () => {
        expect(recipientName({ characterName: "Zibbo", realm: "Spine Shatter" })).toBe("Zibbo-SpineShatter");
        expect(recipientName({ characterName: "Zibbo", realm: "" })).toBe("Zibbo");
        expect(recipientName({ characterName: "", realm: "Spineshatter" })).toBe("");
    });

    it("groups by day in the guild's time zone, newest or oldest first", () => {
        const list = [
            out({ id: "a", handedOutAt: at("2026-10-10T20:00:00Z") }),
            out({ id: "b", handedOutAt: at("2026-10-11T08:00:00Z") }),
            // 23:30 UTC is already the 12th in Berlin
            out({ id: "c", handedOutAt: at("2026-10-11T23:30:00Z") }),
            out({ id: "d", handedOutAt: at("2026-10-11T09:00:00Z") }),
        ];
        expect(groupHandedOutByDay(list).map((d) => [d.day, d.requests.map((r) => r.id)])).toEqual([
            ["2026-10-12", ["c"]], ["2026-10-11", ["d", "b"]], ["2026-10-10", ["a"]],
        ]);
        expect(groupHandedOutByDay(list, { newestFirst: false }).map((d) => d.requests.map((r) => r.id))).toEqual([["a"], ["b", "d"], ["c"]]);
    });

    it("labels today and yesterday, else the weekday with its date", () => {
        const now = at("2026-10-11T12:00:00Z");
        expect(dayLabel(at("2026-10-11T06:00:00Z"), now)).toBe("Heute");
        expect(dayLabel(at("2026-10-10T06:00:00Z"), now)).toBe("Gestern");
        expect(dayLabel(at("2026-10-08T06:00:00Z"), now)).toBe("Donnerstag, 8. Oktober");
    });

    it("filters by category and by item, character or raider", () => {
        const items = new Map([[1, bankItem({ itemId: 1 })], [3, bankItem({ itemId: 3, group: "Fläschchen" })]]);
        const list = [out({ id: "a" }), out({ id: "b", itemId: 3, item: "Flask", characterName: "Bobo", userName: "Bo" }), out({ id: "c", itemId: 9 })];
        expect(filterHandedOut(list, items, { category: "", search: "" }).map((r) => r.id)).toEqual(["a", "b", "c"]);
        expect(filterHandedOut(list, items, { category: "Fläschchen", search: "" }).map((r) => r.id)).toEqual(["b"]);
        expect(filterHandedOut(list, items, { category: "", search: "BOBO" }).map((r) => r.id)).toEqual(["b"]);
        expect(filterHandedOut(list, items, { category: "", search: "anna" }).map((r) => r.id)).toEqual(["a", "c"]);
    });
});
