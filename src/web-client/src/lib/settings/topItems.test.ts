// Top-Items per server and version (#952): which boss an item belongs to, the
// picks per boss and the list "Ohne Zuordnung".
import { describe, expect, it } from "vitest";
import type { TopItem, TopItemRaid } from "../../api";
import { UNASSIGNED, bossKey, bossOfItem, firstView, pickedCounts, tableItemIds, unassignedItems } from "./topItems";

const item = (id: number, name = `Item ${id}`): TopItem => ({ id, name, iconUrl: "", quality: 4 });
const RAIDS: TopItemRaid[] = [
    { id: "bt", label: "Black Temple", short: "BT", tierLabel: "T6", bosses: [
        { name: "Illidan Stormrage", items: [item(32837), item(32838), item(32500)] },
        { name: "Mother Shahraz", items: [item(32500), item(32367)] },
    ] },
    { id: "hyjal", label: "Hyjal Summit", short: "MH", tierLabel: "T6", bosses: [{ name: "Archimonde", items: [item(30910)] }] },
];

describe("top items per boss (#952)", () => {
    it("keys a boss by raid and name", () => {
        expect(bossKey("bt", "Illidan Stormrage")).toBe("bt::Illidan Stormrage");
    });

    it("knows every item of the loot table once", () => {
        expect([...tableItemIds(RAIDS)].sort()).toEqual([30910, 32367, 32500, 32837, 32838]);
    });

    it("finds the first boss dropping an item, none for a foreign one", () => {
        expect(bossOfItem(RAIDS, 32500)).toBe("bt::Illidan Stormrage");
        expect(bossOfItem(RAIDS, 30910)).toBe("hyjal::Archimonde");
        expect(bossOfItem(RAIDS, 1)).toBe("");
    });

    it("counts the picks per boss and the unassigned ones", () => {
        const counts = pickedCounts(RAIDS, [item(32837), item(32500), item(1), item(2)]);
        expect(counts.get("bt::Illidan Stormrage")).toBe(2);
        expect(counts.get("bt::Mother Shahraz")).toBe(1);
        expect(counts.has("hyjal::Archimonde")).toBe(false);
        expect(counts.get(UNASSIGNED)).toBe(2);
    });

    it("lists the unassigned picks, then what was switched off here, each once", () => {
        const rows = unassignedItems(RAIDS, [item(1), item(32837)], [item(2), item(1), item(32838)]);
        expect(rows.map((it) => it.id)).toEqual([1, 2]);
    });

    it("puts everything under Ohne Zuordnung without a loot table (Classic, Forever)", () => {
        expect(unassignedItems([], [item(32837)], []).map((it) => it.id)).toEqual([32837]);
        expect(pickedCounts([], [item(32837)]).get(UNASSIGNED)).toBe(1);
        expect(firstView([])).toBe(UNASSIGNED);
        expect(firstView(RAIDS)).toBe("bt::Illidan Stormrage");
    });
});
