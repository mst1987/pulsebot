import { describe, expect, it } from "vitest";
import { chipsOf, cleanState, countFor, passes, toggle, type FilterDef } from "./filters";

type Item = { name: string; cls: string; days: string[] };
const items: Item[] = [
    { name: "a", cls: "Mage", days: ["mi"] },
    { name: "b", cls: "Mage", days: ["do"] },
    { name: "c", cls: "Warrior", days: ["mi", "do"] },
];
const defs: FilterDef<Item>[] = [
    { key: "class", label: "Klasse", options: ["Mage", "Warrior"].map((c) => ({ value: c, label: c, test: (i: Item) => i.cls === c })) },
    { key: "day", label: "Tag", options: ["mi", "do"].map((d) => ({ value: d, label: d, test: (i: Item) => i.days.includes(d) })) },
];

describe("lib/kader/filters", () => {
    it("is any-of inside a menu and all-of across menus", () => {
        const state = { class: ["Mage", "Warrior"], day: ["mi"] };
        expect(items.filter((i) => passes(i, defs, state)).map((i) => i.name)).toEqual(["a", "c"]);
        expect(items.filter((i) => passes(i, defs, {})).length).toBe(3);
    });

    it("counts each option with the other menus applied", () => {
        const state = { day: ["do"] };
        expect(countFor(items, defs, state, defs[0], defs[0].options[0])).toBe(1);
        // the menu's own picks do not narrow its counts
        expect(countFor(items, defs, state, defs[1], defs[1].options[0])).toBe(2);
    });

    it("toggles picks, names them as chips and repairs a stored state", () => {
        const on = toggle({}, "class", "Mage");
        expect(on).toEqual({ class: ["Mage"] });
        expect(toggle(on, "class", "Mage")).toEqual({});
        expect(chipsOf(defs, { class: ["Mage"], day: ["gone"] })).toEqual([{ key: "class", value: "Mage", label: "Klasse: Mage" }]);
        expect(cleanState(defs, { class: ["Mage", "Druid"], nope: ["x"], day: "mi" })).toEqual({ class: ["Mage"] });
        expect(cleanState(defs, null)).toEqual({});
    });
});
