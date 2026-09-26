// The map height (S/M/L + splitter, remembered) and the class order of a row's pickers (lib/raidplan.ts, lib/assign.ts).
import { describe, expect, it } from "vitest";
import * as raidplan from ".";
import * as assign from "./assign";

describe("map height", () => {
    it("a step is a share of the window's height, bigger steps are bigger", () => {
        const h = (step, vh) => raidplan.mapHeight({ step, px: 0 }, vh);
        expect(h("S", 900)).toBeLessThan(h("M", 900));
        expect(h("M", 900)).toBeLessThan(h("L", 900));
        expect(h("M", 1080)).toBeGreaterThan(h("M", 900));
    });
    it("a hand-set height stays, but inside 200 px and the window minus 160 px", () => {
        expect(raidplan.mapHeight({ step: "C", px: 500 }, 900)).toBe(500);
        expect(raidplan.mapHeight({ step: "C", px: 50 }, 900)).toBe(200);
        expect(raidplan.mapHeight({ step: "C", px: 5000 }, 900)).toBe(740);
        expect(raidplan.mapHeight({ step: "C", px: 5000 }, 300)).toBe(200);
    });
    it("what is remembered comes back; anything else is the default", () => {
        expect(raidplan.parseMapSize(JSON.stringify({ step: "L", px: 0 }))).toEqual({ step: "L", px: 0 });
        expect(raidplan.parseMapSize(JSON.stringify({ step: "C", px: 432.4 }))).toEqual({ step: "C", px: 432 });
        expect(raidplan.parseMapSize(JSON.stringify({ step: "C", px: 99999 }))).toEqual({ step: "C", px: 4000 });
        for (const bad of [null, "", "nope", "{}", JSON.stringify({ step: "X" }), JSON.stringify({ step: "C", px: "a" })]) expect(raidplan.parseMapSize(bad)).toEqual(raidplan.DEFAULT_MAP_SIZE);
    });
});

describe("preferred class in the pickers and the rows", () => {
    const p = (userId, classId) => ({ userId, classId });
    const roster = [p("a", "Priest"), p("b", "Rogue"), p("c", "Mage"), p("d", "Rogue")];
    it("playersByClass puts the preferred classes first, in the order they were chosen, and keeps the rest in order", () => {
        expect(assign.playersByClass(roster, ["Rogue", "Mage"]).map((x) => x.userId)).toEqual(["b", "d", "c", "a"]);
        expect(assign.playersByClass(roster, ["Mage"]).map((x) => x.userId)).toEqual(["c", "a", "b", "d"]);
        expect(assign.playersByClass(roster, [])).toBe(roster);
    });
    it("rowClasses: the row's own classes win over the type's", () => {
        expect(assign.rowClasses({ type: "kick", preferredClasses: ["Priest"] })).toEqual(["Priest"]);
        expect(assign.rowClasses({ type: "kick", preferredClasses: [] })).toEqual(assign.classesForType("kick"));
        expect(assign.rowClasses({ type: "kick" })).toEqual(assign.classesForType("kick"));
    });
    it("outOfClass: only when the row names classes and the person is none of them", () => {
        expect(assign.outOfClass({ preferredClasses: ["Rogue"] }, p("x", "Mage"))).toBe(true);
        expect(assign.outOfClass({ preferredClasses: ["Rogue"] }, p("x", "Rogue"))).toBe(false);
        expect(assign.outOfClass({ preferredClasses: [] }, p("x", "Mage"))).toBe(false);
        expect(assign.outOfClass({}, p("x", "Mage"))).toBe(false);
        expect(assign.outOfClass({ preferredClasses: ["Rogue"] }, null)).toBe(false);
    });
    it("a class has its WoW icon name; a new row starts without preferences", () => {
        expect(assign.classIconOf("Warlock")).toBe("classicon_warlock");
        expect(assign.CLASS_IDS).toHaveLength(9);
        const r = assign.addAssignment({ assignments: [] }, "kick");
        expect(r.board.assignments[0]).toMatchObject({ preferredClasses: [], allowOthers: false });
    });
});
