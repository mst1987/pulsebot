import { describe, expect, it } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanPlayer } from "../../api";
import { boardOf, ensureBesetzung } from "./index";
import { assignOrSwap, clearSlot } from "./rosterAssign";
import { setFlexRole } from "./besetzung";
import { applyTankLineup, differingKeys, roleOrder, sameOrder, tankLineup } from "./tankOrder";

// The tank line-up of the Standard for the other bosses: every section fills its tank slots in setup order; following the
// Standard gives a boss its number of tank slots and its tanks in its order.

const BES: Besetzung = { size: 10, counts: { tank: 3, healer: 2, dps: 5, melee: 0, ranged: 0 }, groups: 2, split: false };
const player = (userId: string, role: string, classId = "Warrior"): RaidplanPlayer => ({
    userId, character: userId.toUpperCase(), classId, className: classId, classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1,
});
const ROSTER = [player("a", "tank"), player("b", "tank", "Paladin"), player("c", "tank", "Druid"), player("h1", "healer", "Priest"), player("h2", "healer", "Shaman")];
const filled = (): RaidplanBoard => ensureBesetzung(boardOf({}, "x"), BES, ROSTER);
const slotId = (b: RaidplanBoard, n: number) => (b.slots.find((s) => s.kind === "tank" && s.n === n) as { id: string }).id;
const apply = (b: RaidplanBoard, want: string[], roster = ROSTER) => applyTankLineup(b, want, BES, roster);

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

describe("tankLineup", () => {
    it("reads every tank slot in order, an open one as empty", () => {
        expect(tankLineup(filled())).toEqual(["a", "b", "c"]);
        expect(tankLineup(clearSlot(filled(), slotId(filled(), 2)))).toEqual(["a", "", "c"]);
    });
});

describe("applyTankLineup", () => {
    it("puts the board's tanks into the given order", () => {
        expect(roleOrder(apply(filled(), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
    });

    it("hands back the same board when nothing changes", () => {
        const b = filled();
        expect(apply(b, ["a", "b", "c"])).toBe(b);
    });

    it("an open place of the Standard and a player not in this lineup are skipped: the next tank moves up", () => {
        expect(tankLineup(apply(filled(), ["a", "", "c"]))).toEqual(["a", "c", "b"]);
        expect(tankLineup(apply(filled(), ["a", "x", "c"]))).toEqual(["a", "c", "b"]);
    });

    it("more tanks in the Standard (2 -> 3): the boss gets the slot and the Standard's third tank, from where he stood", () => {
        // the cat druid: a melee who tanks in the Standard's Tank 3; on the boss he stands in a DPS slot
        const roster = [...ROSTER.filter((p) => p.userId !== "c"), player("cat", "melee", "Druid")];
        const two: Besetzung = { ...BES, counts: { ...BES.counts, tank: 2 } };
        const boss = ensureBesetzung(boardOf({}, "x"), two, roster);
        expect(tankLineup(boss)).toEqual(["a", "b"]);
        const dps = boss.slots.find((s) => s.userId === "cat") as { id: string; kind: string };
        expect(dps.kind).toBe("dps");
        const next = applyTankLineup(boss, ["a", "b", "cat"], two, roster);
        expect(tankLineup(next)).toEqual(["a", "b", "cat"]);
        expect(next.counts && next.counts.tank).toBe(3);
        expect(next.slots.find((s) => s.id === dps.id)).toMatchObject({ userId: "" });
        expect(next.roles).toEqual({});
    });

    it("fewer tanks in the Standard: the last tank slot goes", () => {
        const next = apply(filled(), ["b", "a"]);
        expect(tankLineup(next)).toEqual(["b", "a"]);
        expect(next.counts && next.counts.tank).toBe(2);
    });

    it("a Standard tank who stands elsewhere swaps with the one in his tank slot; a free token of his goes", () => {
        // this boss: "b" heals (flex role) and sits in a healer slot, so b's Tank 2 is filled by nobody; then "h1" is put into Tank 2
        let b = filled();
        b = assignOrSwap(b, slotId(b, 2), "h1");
        const healerSlot = b.slots.find((s) => s.kind === "healer" && s.n === 1) as { id: string };
        b = { ...b, slots: b.slots.map((s) => (s.id === healerSlot.id ? { ...s, userId: "b" } : s)), tokens: [{ id: "tk", userId: "b", x: 0.5, y: 0.5 } as never] };
        const next = apply(b, ["a", "b", "c"]);
        expect(tankLineup(next)).toEqual(["a", "b", "c"]);
        expect(next.slots.find((s) => s.id === healerSlot.id)).toMatchObject({ userId: "h1" });
        expect(next.tokens).toEqual([]);
    });

    it("one who plays another role on this boss on purpose stays where he is; the next tank is Tank 1", () => {
        const b = setFlexRole(filled(), ROSTER, "b", "healer");
        expect(tankLineup(b)).toEqual(["a", "", "c"]);
        const next = apply(b, ["b", "a", "c"]);
        expect(tankLineup(next)).toEqual(["a", "c", ""]);
        expect(next.roles).toEqual({ b: "healer" });
    });

    it("a displaced player loses a flex role 'tank' he no longer plays", () => {
        // "h1" tanks on this boss (flex), the Standard has "a" there instead
        let b = setFlexRole(filled(), ROSTER, "h1", "tank");
        b = assignOrSwap(b, slotId(b, 1), "h1");
        const next = apply(b, ["a", "b", "c"]);
        expect(tankLineup(next)).toEqual(["a", "b", "c"]);
        expect(next.roles.h1).toBeUndefined();
    });

    it("moves only the players: places on the map, other roles and the class pick of untouched slots stay", () => {
        const b = filled();
        const placed = { ...b, slots: b.slots.map((s) => (s.kind === "tank" ? { ...s, placed: true, x: s.n / 10, y: 0.5, byClass: true } : s)) };
        const next = apply(placed, ["b", "a", "c"]);
        const tank = (n: number) => next.slots.find((s) => s.kind === "tank" && s.n === n);
        expect(tank(1)).toMatchObject({ userId: "b", x: 0.1, placed: true, byClass: false });
        expect(tank(3)).toMatchObject({ userId: "c", byClass: true });
        expect(roleOrder(next, "healer")).toEqual(["h1", "h2"]);
    });
});

describe("differingKeys / sameOrder", () => {
    it("names the sections whose line-up would change", () => {
        const boards: Record<string, RaidplanBoard> = { one: filled(), two: apply(filled(), ["b", "a", "c"]) };
        expect(differingKeys((k) => boards[k], ["one", "two"], ["b", "a", "c"], BES, ROSTER)).toEqual(["one"]);
        expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
        expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
        expect(sameOrder(["a"], ["a", "b"])).toBe(false);
    });
});
