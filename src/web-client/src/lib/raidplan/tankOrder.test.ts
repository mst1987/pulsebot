import { describe, expect, it } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanPlayer } from "../../api";
import { boardOf, ensureBesetzung } from "./index";
import { assignOrSwap, clearSlot } from "./rosterAssign";
import { applyRoleOrder, differingKeys, roleOrder, sameOrder } from "./tankOrder";

// The tank order of the Standard for the other bosses: every section fills its tank slots in setup order; following the
// Standard only reorders the tanks a board already has.

const BES: Besetzung = { size: 10, counts: { tank: 3, healer: 2, dps: 5, melee: 0, ranged: 0 }, groups: 2, split: false };
const player = (userId: string, role: string, classId = "Warrior"): RaidplanPlayer => ({
    userId, character: userId.toUpperCase(), classId, className: classId, classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1,
});
const ROSTER = [player("a", "tank"), player("b", "tank", "Paladin"), player("c", "tank", "Druid"), player("h1", "healer", "Priest"), player("h2", "healer", "Shaman")];
const filled = (): RaidplanBoard => ensureBesetzung(boardOf({}, "x"), BES, ROSTER);
const slotId = (b: RaidplanBoard, n: number) => (b.slots.find((s) => s.kind === "tank" && s.n === n) as { id: string }).id;

describe("roleOrder", () => {
    it("reads the tanks in slot order, the setup's order on a fresh board", () => {
        expect(roleOrder(filled())).toEqual(["a", "b", "c"]);
        expect(roleOrder(filled(), "healer")).toEqual(["h1", "h2"]);
    });

    it("follows the slot numbers, not the stored order, and leaves open slots out", () => {
        const b = filled();
        const swapped = assignOrSwap(b, slotId(b, 1), "c");
        expect(roleOrder({ ...swapped, slots: [...swapped.slots].reverse() })).toEqual(["c", "b", "a"]);
        expect(roleOrder(clearSlot(b, slotId(b, 2)))).toEqual(["a", "c"]);
    });
});

describe("applyRoleOrder", () => {
    it("puts the board's tanks into the given order", () => {
        const b = applyRoleOrder(filled(), ["c", "a", "b"]);
        expect(roleOrder(b)).toEqual(["c", "a", "b"]);
    });

    it("hands back the same board when nothing moves", () => {
        const b = filled();
        expect(applyRoleOrder(b, ["a", "b", "c"])).toBe(b);
        expect(applyRoleOrder(b, [])).toBe(b);
    });

    it("never adds or removes a player: a tank missing on this board is skipped, an extra one keeps his relative place after", () => {
        // this boss: "b" is a healer here (flex role), so its tanks are a and c only
        const b = clearSlot(filled(), slotId(filled(), 2));
        const next = applyRoleOrder(b, ["c", "b", "x"]);
        expect(roleOrder(next)).toEqual(["c", "a"]);
        expect(next.slots.filter((s) => s.kind === "tank" && s.userId).map((s) => s.n)).toEqual([1, 3]);
    });

    it("moves only the players: places on the map, other roles and the class pick of untouched slots stay", () => {
        const b = filled();
        const placed = { ...b, slots: b.slots.map((s) => (s.kind === "tank" ? { ...s, placed: true, x: s.n / 10, y: 0.5, byClass: true } : s)) };
        const next = applyRoleOrder(placed, ["b", "a", "c"]);
        const tank = (n: number) => next.slots.find((s) => s.kind === "tank" && s.n === n);
        expect(tank(1)).toMatchObject({ userId: "b", x: 0.1, placed: true, byClass: false });
        expect(tank(3)).toMatchObject({ userId: "c", byClass: true });
        expect(roleOrder(next, "healer")).toEqual(["h1", "h2"]);
    });
});

describe("differingKeys / sameOrder", () => {
    it("names the sections whose order would change", () => {
        const boards: Record<string, RaidplanBoard> = { one: filled(), two: applyRoleOrder(filled(), ["b", "a", "c"]) };
        expect(differingKeys((k) => boards[k], ["one", "two"], ["b", "a", "c"])).toEqual(["one"]);
        expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
        expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
        expect(sameOrder(["a"], ["a", "b"])).toBe(false);
    });
});
