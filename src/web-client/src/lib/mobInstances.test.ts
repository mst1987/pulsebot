// One mob of several (docs/raidplan.md, "One mob of several"): two Flames of Azzinoth on the map are two targets, not one kind. A row
// means ONE placed icon (`oid`); a row of the kind (older plans) still works for every icon nobody named. Auto placement, the facing, the
// tank lines and the labels all read it the same way.
import { describe, expect, it } from "vitest";
import * as auto from "./autoPlace";
import * as assign from "./assign";
import * as modalLib from "./assignModal";

const FLAME = { kind: "mob", ref: "d:flame", name: "Flame of Azzinoth", icon: "" };
const icon = (id, x, y, extra = {}) => ({ id, iconKey: "enemy", label: "Flame", x, y, size: 48, rotation: 0, showLabel: false, mobId: "d:flame", autoFace: true, ...extra });
const board = (extra = {}) => ({ tokens: [], slots: [], marks: [], icons: [icon("f1", 0.3, 0.3), icon("f2", 0.7, 0.3)], zones: [], lines: [], texts: [], assignments: [], autoPlace: true, autoPos: {}, objectScale: 1, ...extra });
const row = (id, assignees, targets) => ({ id, type: "tank", title: "", spell: null, assignees, targets, note: "", suggested: false });
const tok = (userId, x, y) => ({ userId, x, y });
const roster = [{ userId: "u1", character: "Tankwart", classId: "Warrior", role: "tank", group: 1 }, { userId: "u2", character: "Bollwerk", classId: "Paladin", role: "tank", group: 1 }];
const EVENT = { template: false, roster };

describe("the targets of a mob that stands twice on the map", () => {
    it("offers one target per icon, numbered in the board's order; one icon (or none) = the mob as such", () => {
        const b = board();
        expect(auto.mobTargetsFor(b, FLAME)).toEqual([
            { kind: "mob", ref: "d:flame", name: "Flame of Azzinoth", icon: "", n: 1, oid: "f1" },
            { kind: "mob", ref: "d:flame", name: "Flame of Azzinoth", icon: "", n: 2, oid: "f2" },
        ]);
        expect(auto.mobTargetsFor(board({ icons: [icon("f1", 0.3, 0.3)] }), FLAME)).toEqual([FLAME]);
        // a hidden icon does not count
        expect(auto.mobTargetsFor(board({ icons: [icon("f1", 0.3, 0.3), icon("f2", 0.7, 0.3, { hidden: true })] }), FLAME)).toEqual([FLAME]);
        expect(auto.mobIconNo(b, "f2")).toBe(2);
        expect(auto.mobIconNo(board({ icons: [icon("f1", 0.3, 0.3)] }), "f1")).toBe(0);
    });

    it("a target of one icon is only that icon (choosing, removing, the tile key)", () => {
        const [one, two] = auto.mobTargetsFor(board(), FLAME);
        expect(auto.sameTargetAs(one, two)).toBe(false);
        expect(auto.sameTargetAs(one, { ...one })).toBe(true);
        expect(auto.sameTargetAs(FLAME, one)).toBe(false);
        expect(modalLib.targetKey(two)).toBe("mob|d:flame@f2");
        expect(modalLib.targetKey(FLAME)).toBe("mob|d:flame");
        expect(modalLib.chosenKeys(row("r", [], [two, { kind: "mark", ref: "skull" }]), "at")).toEqual(["mob|d:flame@f2", "mark|skull"]);
        // toggling one icon's target keeps the other one
        let b = board({ assignments: [row("r", ["user:u1"], [one])] });
        b = assign.toggleTarget(b, "r", two);
        expect(b.assignments[0].targets.map((x) => x.oid)).toEqual(["f1", "f2"]);
        b = assign.toggleTarget(b, "r", one);
        expect(b.assignments[0].targets.map((x) => x.oid)).toEqual(["f2"]);
    });

    it("labels: by the icon's number on the map (live), else the number the target carries", () => {
        const [, two] = auto.mobTargetsFor(board(), FLAME);
        const ctx = { slots: [], players: new Map(), icons: board().icons };
        expect(assign.resolveTarget(two, ctx).label).toBe("Flame of Azzinoth 2");
        // the icons in the other order: the label follows the map
        expect(assign.resolveTarget(two, { ...ctx, icons: [icon("f2", 0, 0), icon("f1", 0, 0)] }).label).toBe("Flame of Azzinoth 1");
        // no map at hand (a section of the sheet without its map): the stored number
        expect(assign.resolveTarget(two, { slots: [], players: new Map() }).label).toBe("Flame of Azzinoth 2");
        expect(assign.resolveTarget(FLAME, ctx).label).toBe("Flame of Azzinoth");
    });
});

describe("auto placement and facing, one tank per icon", () => {
    const [one, two] = auto.mobTargetsFor(board(), FLAME);

    it("two rows, one per icon: each icon plays its own instance, each tank goes to its own Flame", () => {
        const b = board();
        const plan = auto.deriveAuto([row("a", ["user:u1"], [one]), row("b", ["user:u2"], [two])], b, EVENT);
        expect(plan.mobs.map((m) => [m.key, m.iconId, m.inst, m.count])).toEqual([["m:d:flame@f1", "f1", 1, 2], ["m:d:flame@f2", "f2", 2, 2]]);
        expect(plan.tanks.map((t) => [t.userId, t.mobKey])).toEqual([["u1", "m:d:flame@f1"], ["u2", "m:d:flame@f2"]]);
        // each icon faces its own tank (the tanks stand in front of their Flame)
        const places = auto.autoPlaces(plan);
        const f1 = auto.autoFacing(plan, "f1", b.icons[0], b, places, 1);
        const f2 = auto.autoFacing(plan, "f2", b.icons[1], b, places, 1);
        const t1 = plan.tanks[0];
        const t2 = plan.tanks[1];
        expect(f1).toBe(assign.angleBetween(b.icons[0], t1, 1));
        expect(f2).toBe(assign.angleBetween(b.icons[1], t2, 1));
    });

    it("only the second icon named: its row takes it, not the first one", () => {
        const plan = auto.deriveAuto([row("b", ["user:u2"], [two])], board(), EVENT);
        expect(plan.mobs.map((m) => [m.key, m.iconId])).toEqual([["m:d:flame@f2", "f2"]]);
    });

    it("older plans: a row of the kind takes the next icon nobody named, with that icon's number", () => {
        const plan = auto.deriveAuto([row("a", ["user:u1"], [two]), row("b", ["user:u2"], [FLAME])], board(), EVENT);
        const kind = plan.mobs.find((m) => m.key.indexOf("#") > 0);
        expect(kind).toMatchObject({ iconId: "f1", inst: 1 });
        expect(plan.tanks.find((t) => t.userId === "u2").mobKey).toBe(kind.key);
    });

    it("an icon that is gone: its target means the kind again (nothing breaks)", () => {
        const plan = auto.deriveAuto([row("b", ["user:u2"], [{ ...two, oid: "gone" }])], board(), EVENT);
        expect(plan.mobs).toHaveLength(1);
        expect(plan.mobs[0].key).toMatch(/^m:d:flame#/);
    });

    it("facingOf (no auto placement): a named icon faces its own tank; the kind's rows turn the other icons", () => {
        const b = board({
            autoPlace: false,
            tokens: [tok("u1", 0.3, 0.8), tok("u2", 0.7, 0.8)],
            assignments: [row("a", ["user:u1"], [FLAME]), row("b", ["user:u2"], [two])],
        });
        // f2 is named by row b: faces u2 (straight down); f1 faces the kind's tank u1 (straight down too)
        expect(assign.facingOf(b, b.icons[1], 1)).toBe(180);
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(180);
        // swap the tanks' places: the named icon still follows ITS tank
        const c = { ...b, tokens: [tok("u1", 0.7, 0.8), tok("u2", 0.3, 0.8)] };
        expect(assign.facingOf(c, c.icons[1], 1)).toBe(assign.angleBetween(c.icons[1], { x: 0.3, y: 0.8 }, 1));
        expect(assign.facingOf(c, c.icons[0], 1)).toBe(assign.angleBetween(c.icons[0], { x: 0.7, y: 0.8 }, 1));
        // older plan, only the kind: both icons take the kind's tanks in the board's order (unchanged)
        const d = { ...b, assignments: [row("a", ["user:u1"], [FLAME]), row("b", ["user:u2"], [FLAME])] };
        expect(assign.tanksOfMob(d, "d:flame")).toHaveLength(2);
        expect(assign.followsTank(b, b.icons[1])).toBe(true);
    });
});
