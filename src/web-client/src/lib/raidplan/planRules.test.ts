// Pure rules of the plan: who is gone from the lineup, lines only between things on the map, the icon that follows its tank.
import { describe, expect, it } from "vitest";
import * as raidplan from ".";
import * as assign from "./assign";

const player = (userId, role = "dps", group = 1) => ({ userId, character: userId, group, role });
const slot = (kind, n, userId = "", x = 0.5, y = 0.5, extra = {}) => ({ id: `${kind}${n}`, kind, n, userId, x, y, label: "", ...extra });
const board = (over = {}) => ({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", counts: null, roles: {}, mobs: [], hiddenCards: [], ...over });
const row = (type, assignees, targets) => ({ id: `${type}-${assignees.join("")}`, type, title: "", assignees, targets, note: "" });

describe("dropGone: the lineup changed after the plan was made", () => {
    const roster = [player("a"), player("b")];
    it("takes a player who is not in the lineup off his slot and off the board as a token", () => {
        const b = board({ slots: [slot("tank", 1, "a"), slot("healer", 1, "x")], tokens: [{ userId: "x", x: 0.1, y: 0.1 }, { userId: "b", x: 0.2, y: 0.2 }] });
        const r = raidplan.dropGone(b, roster);
        expect(r.slots.map((s) => s.userId)).toEqual(["a", ""]);
        expect(r.tokens.map((k) => k.userId)).toEqual(["b"]);
    });
    it("changes nothing (same object) when everybody is still there, and nothing without a roster (a template)", () => {
        const b = board({ slots: [slot("tank", 1, "a")] });
        expect(raidplan.dropGone(b, roster)).toBe(b);
        const b2 = board({ slots: [slot("tank", 1, "x")] });
        expect(raidplan.dropGone(b2, [])).toBe(b2);
    });
});

describe("assignment lines only between two things on the map", () => {
    const heal = row("heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }, { kind: "group", ref: "3" }]);
    it("draws a line when both ends are placed", () => {
        const b = board({ assignments: [heal], slots: [slot("healer", 1, "", 0.2, 0.2, { placed: true }), slot("tank", 1, "", 0.6, 0.6), slot("group", 3, "", 0.8, 0.8)] });
        expect(assign.assignmentLinks(b)).toHaveLength(2);
    });
    it("draws nothing to a group or slot that is only in the Besetzung, or from an unplaced healer", () => {
        const b = board({ assignments: [heal], slots: [slot("healer", 1, "", 0.2, 0.2), slot("tank", 1, "", 0.6, 0.6, { placed: false }), slot("group", 3, "", 0, 0, { placed: false })] });
        expect(assign.assignmentLinks(b)).toEqual([]);
        const c = board({ assignments: [heal], slots: [slot("healer", 1, "", 0.2, 0.2, { placed: false }), slot("tank", 1, "", 0.6, 0.6), slot("group", 3, "", 0.8, 0.8)] });
        expect(assign.assignmentLinks(c)).toEqual([]);
    });
    it("a hidden slot has no line either, and one placed end is not enough", () => {
        const b = board({ assignments: [heal], slots: [slot("healer", 1, "", 0.2, 0.2), slot("tank", 1, "", 0.6, 0.6, { hidden: true }), slot("group", 3, "", 0.8, 0.8, { placed: false })] });
        expect(assign.assignmentLinks(b)).toEqual([]);
    });
});

describe("the icon that follows its tank", () => {
    const tankRow = row("tank", ["slot:tank:2", "slot:tank:1"], [{ kind: "mob", ref: "d:gathios", name: "G", icon: "" }]);
    const icon = (over = {}) => ({ id: "i1", iconKey: "mob:22949", x: 0.5, y: 0.5, rotation: 90, mobId: "d:gathios", autoFace: true, ...over });
    it("angleBetween: 0 = up, clockwise, and the board's aspect ratio counts", () => {
        const o = { x: 0.5, y: 0.5 };
        expect(assign.angleBetween(o, { x: 0.5, y: 0.2 }, 1.6)).toBe(0);
        expect(assign.angleBetween(o, { x: 0.8, y: 0.5 }, 1.6)).toBe(90);
        expect(assign.angleBetween(o, { x: 0.5, y: 0.8 }, 1.6)).toBe(180);
        expect(assign.angleBetween(o, { x: 0.2, y: 0.5 }, 1.6)).toBe(270);
        expect(assign.angleBetween(o, { x: 0.6, y: 0.4 }, 1)).toBe(45);
        expect(assign.angleBetween(o, { x: 0.6, y: 0.4 }, 2)).toBe(63);
        expect(assign.angleBetween(o, o, 1.6)).toBe(0);
    });
    it("turns to the first assignee that is on the map, and follows when the tank moves", () => {
        const b = board({ assignments: [tankRow], slots: [slot("tank", 1, "", 0.5, 0.9), slot("tank", 2, "", 0.5, 0.1)] });
        expect(assign.facingOf(b, icon(), 1.6)).toBe(0);
        const moved = { ...b, slots: [slot("tank", 1, "", 0.5, 0.9), slot("tank", 2, "", 0.9, 0.5, { placed: true })] };
        expect(assign.facingOf(moved, icon(), 1)).toBe(90);
    });
    it("skips a first tank who is not on the map and takes the next", () => {
        const b = board({ assignments: [tankRow], slots: [slot("tank", 2, "", 0.5, 0.1, { placed: false }), slot("tank", 1, "", 0.5, 0.9)] });
        expect(assign.facingOf(b, icon(), 1.6)).toBe(180);
    });
    it("keeps its own rotation without a placed tank, without a mob, or when switched off", () => {
        const none = board({ assignments: [tankRow], slots: [slot("tank", 1, "", 0.5, 0.9, { placed: false })] });
        expect(assign.facingOf(none, icon(), 1.6)).toBe(90);
        const b = board({ assignments: [tankRow], slots: [slot("tank", 1, "", 0.5, 0.9)] });
        expect(assign.facingOf(b, icon({ mobId: "" }), 1.6)).toBe(90);
        expect(assign.facingOf(b, icon({ autoFace: false }), 1.6)).toBe(90);
        expect(assign.facingOf(b, icon({ mobId: "d:other" }), 1.6)).toBe(90);
        expect(assign.followsTank(b, icon())).toBe(true);
        expect(assign.followsTank(b, icon({ autoFace: false }))).toBe(false);
    });
});
