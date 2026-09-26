// The flyout's pure logic (lib/raidplan/flyout.ts) and the card hide / remove logic of the assignments (lib/raidplan/assign.ts).
import { describe, expect, it } from "vitest";
import * as fly from "./flyout";
import * as assign from "./assign";

const item = (key, group, on = false, label = key) => ({ key, label, on, group });

describe("flyout sections and paging", () => {
    const items = [item("a", "Tank"), item("b", "Heal", true), item("c", "Tank"), item("d", "DPS")];
    it("groups in order of first appearance", () => {
        expect(fly.sectionsOf(items).map((s) => [s.title, s.items.map((i) => i.key)])).toEqual([["Tank", ["a", "c"]], ["Heal", ["b"]], ["DPS", ["d"]]]);
    });
    it("filters by search text and tab", () => {
        expect(fly.filterItems(items, "", "Tank").map((i) => i.key)).toEqual(["a", "c"]);
        expect(fly.filterItems(items, " B ", "").map((i) => i.key)).toEqual(["b"]);
        expect(fly.filterItems(items, "zzz", "")).toEqual([]);
    });
    it("paginates: no page exceeds the capacity, nothing is lost, a big section continues under its title", () => {
        const many = Array.from({ length: 30 }, (_, i) => item(`k${i}`, "Big"));
        const pages = fly.paginate(fly.sectionsOf([...many, item("x", "Small")]), 12);
        const cost = (p) => p.sections.reduce((n, s) => n + fly.TITLE_COST + s.items.length, 0);
        pages.forEach((p) => expect(cost(p)).toBeLessThanOrEqual(12));
        expect(pages.flatMap((p) => p.sections.flatMap((s) => s.items)).length).toBe(31);
        expect(pages[1].sections[0].title).toBe("Big");
    });
    it("a small section is not split across pages when it fits on the next one", () => {
        const pages = fly.paginate([{ title: "A", items: [item("1", "A"), item("2", "A"), item("3", "A")] }, { title: "B", items: [item("4", "B"), item("5", "B"), item("6", "B")] }], 8);
        expect(pages.length).toBe(2);
        expect(pages[1].sections[0].items.length).toBe(3);
    });
    it("no entries: no pages", () => {
        expect(fly.paginate([], 10)).toEqual([]);
    });
});

describe("flyout ticking", () => {
    it("range keys include both ends, in either direction; unknown keys fall back to the clicked one", () => {
        expect(fly.rangeKeys(["a", "b", "c", "d"], "b", "d")).toEqual(["b", "c", "d"]);
        expect(fly.rangeKeys(["a", "b", "c", "d"], "c", "a")).toEqual(["a", "b", "c"]);
        expect(fly.rangeKeys(["a"], "x", "a")).toEqual(["a"]);
    });
    it("'all' switches on what is off, or everything off when all are on", () => {
        expect(fly.toggleAllKeys({ title: "t", items: [item("a", "t", true), item("b", "t")] })).toEqual(["b"]);
        expect(fly.toggleAllKeys({ title: "t", items: [item("a", "t", true), item("b", "t", true)] })).toEqual(["a", "b"]);
        expect(fly.toggleAllKeys({ title: "t", items: [] })).toEqual([]);
    });
    it("counts the ticked entries", () => {
        expect(fly.ticked([item("a", "g", true), item("b", "g"), item("c", "g", true)])).toBe(2);
    });
});

describe("flyout placement", () => {
    const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });
    it("right of the card when there is room, else left, else a bottom sheet", () => {
        const panel = { w: 400, h: 300 };
        expect(fly.placeFlyout(rect(100, 100, 400, 500), rect(120, 120, 200, 150), panel, { w: 1440, h: 900 }).side).toBe("right");
        expect(fly.placeFlyout(rect(900, 100, 1300, 500), rect(920, 120, 1000, 150), panel, { w: 1440, h: 900 }).side).toBe("left");
        expect(fly.placeFlyout(rect(0, 0, 380, 500), rect(10, 10, 60, 40), panel, { w: 390, h: 800 }).side).toBe("sheet");
    });
    it("stays inside the viewport vertically", () => {
        const p = fly.placeFlyout(rect(100, 700, 400, 890), rect(120, 800, 200, 830), { w: 400, h: 300 }, { w: 1440, h: 900 });
        expect(p.top + 300).toBeLessThanOrEqual(900);
    });
});

describe("hiding and removing cards", () => {
    const row = (id, type) => ({ id, type, targets: [], assignees: [], text: "" });
    const board = (over = {}) => ({ assignments: [], hiddenCards: [], ...over });
    it("default cards are the area's defaults", () => {
        expect(assign.isDefaultCard("boss", "tank")).toBe(true);
        expect(assign.isDefaultCard("boss", "curse")).toBe(false);
    });
    it("a hidden default card is not offered any more, showing it brings it back", () => {
        const b = assign.hideCard(board(), "tank");
        expect(b.hiddenCards).toEqual(["tank"]);
        expect(assign.cardTypes("boss", b.assignments, [], false, b.hiddenCards)).not.toContain("tank");
        const again = assign.showCard(b, "tank");
        expect(again.hiddenCards).toEqual([]);
        expect(assign.cardTypes("boss", again.assignments, [], false, again.hiddenCards)).toContain("tank");
    });
    it("hiding twice keeps one entry; the rows of the card go with it", () => {
        const b = assign.hideCard(assign.hideCard(board({ assignments: [row("1", "tank"), row("2", "heal")] }), "tank"), "tank");
        expect(b.hiddenCards).toEqual(["tank"]);
        expect(b.assignments.map((a) => a.id)).toEqual(["2"]);
    });
    it("a card with rows stays visible in the read view even when hidden types exist elsewhere", () => {
        expect(assign.cardTypes("boss", [row("1", "curse")], [], true, ["tank"])).toEqual(["curse"]);
    });
    it("removing an added card deletes only its rows", () => {
        const b = assign.removeCard(board({ assignments: [row("1", "curse"), row("2", "curse"), row("3", "heal")] }), "curse");
        expect(b.assignments.map((a) => a.id)).toEqual(["3"]);
        expect(b.hiddenCards).toEqual([]);
    });
});
