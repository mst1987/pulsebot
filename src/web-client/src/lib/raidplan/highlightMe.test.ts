// "That is you" in the assignments: the lines that concern the visitor (lib/raidplan/assign.ts).
import { describe, expect, it } from "vitest";
import * as assign from "./assign";

const slot = (kind, n, userId = "", x = 0.3, y = 0.3) => ({ id: `${kind}${n}`, kind, n, userId, x, y, label: "" });
const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });

describe("lines that concern the visitor", () => {
    const board = { slots: [slot("healer", 1, "h1", 0.2, 0.2), slot("healer", 2, "h2", 0.3, 0.2), slot("tank", 1, "t1", 0.5, 0.5), slot("tank", 2, "t2", 0.6, 0.5)], tokens: [], marks: [], assignments: [
        row("x", "heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }]),
        row("y", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:2" }]),
        row("z", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:1" }]),
    ] };
    it("are marked when the visitor is the healer or the one healed", () => {
        const links = assign.assignmentLinks(board, ["h1"]);
        expect(links.map((k) => !!k.mine)).toEqual([true, false, false]);
        const tank = assign.assignmentLinks(board, ["t1"]);
        expect(tank.map((k) => !!k.mine)).toEqual([true, false, true]);
        expect(assign.assignmentLinks(board).every((k) => !k.mine)).toBe(true);
    });
});
