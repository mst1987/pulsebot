// A board with missing array fields must not crash (regression: "n.assignments is not iterable" when a mob was put on the map as an icon).
import { describe, expect, it } from "vitest";
import * as raidplan from ".";
import * as assign from "./assign";

describe("boards without every array", () => {
    const bare = { tokens: [], slots: [] };
    it("the facing of a mob icon works on a board that has no assignments (the map hands over tokens and slots only)", () => {
        const icon = { x: 0.5, y: 0.5, rotation: 30, mobId: "m1", autoFace: true };
        expect(assign.facingOf(bare, icon, 1.6)).toBe(30);
        expect(assign.tankOfMob(bare, "m1")).toBe(null);
        expect(assign.followsTank(bare, icon)).toBe(false);
        expect(assign.assignmentCount(bare)).toBe(0);
    });
    it("a tank row without targets or assignees is skipped, not a crash", () => {
        const b = { ...bare, assignments: [{ id: "a", type: "tank" }] };
        expect(assign.tankOfMob(b, "m1")).toBe(null);
    });
    it("a stored board with nothing in it is completed by boardOf: every array is there", () => {
        const b = raidplan.boardOf({ x: { notes: "n" } }, "x");
        for (const k of ["tokens", "slots", "marks", "icons", "zones", "lines", "texts", "assignments", "mobs", "hiddenCards", "inheritOff"]) expect(Array.isArray(b[k])).toBe(true);
    });
    it("putting a mob on the map as an icon makes a complete icon with its mob id and turns nothing without a tank", () => {
        const r = raidplan.insertObject(raidplan.emptyBoard(), { type: "icon", iconKey: "boss", label: "Boss", mobId: "m1" }, null);
        expect(r.board.icons).toHaveLength(1);
        expect(r.board.icons[0]).toMatchObject({ mobId: "m1", label: "Boss" });
        expect(Array.isArray(r.board.assignments)).toBe(true);
        expect(assign.facingOf(r.board, r.board.icons[0], 1.6)).toBe(r.board.icons[0].rotation || 0);
    });
    it("an icon faces the tank it has when one is on the map", () => {
        const b = { ...raidplan.emptyBoard(), tokens: [{ userId: "u1", x: 0.5, y: 0.2 }], assignments: [{ id: "a", type: "tank", assignees: ["user:u1"], targets: [{ kind: "mob", ref: "m1" }] }] };
        expect(assign.facingOf(b, { x: 0.5, y: 0.5, rotation: 90, mobId: "m1" }, 1.6)).toBe(0);
    });
});
