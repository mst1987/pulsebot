// The look of the objects the tank rows put on the map (board.autoStyle / autoScale): size, opacity, ring, name, label, facing, lock,
// hidden and order like any object, kept by key; the layout grows with them; the multi selection takes them along.
import { describe, expect, it } from "vitest";
import * as raidplan from ".";
import * as ms from "./multiSelect";
import * as auto from "./autoPlace";

const board = (extra = {}) => ({ ...raidplan.emptyBoard(), ...extra });
const row = (id, assignees, targets) => ({ id, type: "tank", title: "", spell: null, assignees, targets, note: "", suggested: false });
const BOSS = { kind: "mob", ref: "b:bt/illidan", name: "Illidan", icon: "" };
const FLAME = { kind: "mob", ref: "d:flame", name: "Flame", icon: "" };
const roster = [{ userId: "u1", classId: "Warrior", role: "tank", group: 1 }, { userId: "u2", classId: "Paladin", role: "tank", group: 1 }, { userId: "u3", classId: "Druid", role: "tank", group: 2 }];
const OPTS = { template: false, roster };
const ROWS = [row("r1", ["user:u1"], [BOSS]), row("r2", ["user:u2"], [FLAME]), row("r3", ["user:u3"], [FLAME])];
const W = 1000;
const H = 625;
/** No two auto objects overlap, with their real sizes (reference px x the board's symbol size). */
function noOverlap(plan, scale = 1) {
    const pts = [...plan.mobs.filter((m) => !m.iconId), ...plan.tanks.filter((t) => !t.existing)].map((o) => ({ x: o.x * W, y: o.y * H, r: (o.size * scale) / 2 }));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < pts[i].r + pts[j].r) return false;
    return true;
}

describe("the look of one auto object", () => {
    it("size, opacity, lock, hidden, ring and name go through the same functions as every object, only what differs is stored", () => {
        let b = board();
        b = raidplan.setObjectPercent(b, "auto", "m:b:bt/illidan#1", 60);
        expect(raidplan.objectPercent(b, "auto", "m:b:bt/illidan#1")).toBe(60);
        expect(b.autoStyle["m:b:bt/illidan#1"]).toEqual({ size: 29 });
        b = raidplan.setObjectPercent(b, "auto", "t:r1:1", 50);
        expect(raidplan.sizeOf(b, "auto", "t:r1:1")).toBe(19);
        b = raidplan.patchLook(b, "auto", "t:r1:1", { opacity: 0.5, ring: false, showName: false });
        expect(raidplan.lookOf(b, "auto", "t:r1:1")).toEqual({ opacity: 0.5, lock: false, hidden: false, ring: false, showName: false });
        // back to the default: nothing left of it
        b = raidplan.setObjectPercent(b, "auto", "m:b:bt/illidan#1", 100);
        expect(b.autoStyle["m:b:bt/illidan#1"]).toBeUndefined();
        // the range of its kind: a tank is a token (10..152), a mob an icon (12..192)
        expect(raidplan.sizeOf(raidplan.setObjectSize(b, "auto", "t:r1:1", 999), "auto", "t:r1:1")).toBe(152);
        expect(raidplan.sizeOf(raidplan.setObjectPercent(b, "auto", "m:d:flame#1", 400), "auto", "m:d:flame#1")).toBe(192);
    });

    it("a locked one keeps size and place; front / back order them; Alles zurücksetzen takes place and look away; it is never deleted on its own", () => {
        let b = raidplan.patchLook(board({ autoPos: { "t:r1:1": { x: 0.2, y: 0.2 } } }), "auto", "t:r1:1", { lock: true });
        expect(raidplan.setObjectPercent(b, "auto", "t:r1:1", 200)).toBe(b);
        expect(raidplan.moveObject(b, "auto", "t:r1:1", 0.9, 0.9)).toBe(b);
        b = raidplan.reorderObject(b, "auto", "t:r2:1", "front");
        b = raidplan.reorderObject(b, "auto", "t:r3:1", "back");
        expect([b.autoStyle["t:r2:1"].z, b.autoStyle["t:r3:1"].z]).toEqual([1, -1]);
        const r = raidplan.resetAutoAll(b, "t:r1:1");
        expect(r.autoPos["t:r1:1"]).toBeUndefined();
        expect(r.autoStyle["t:r1:1"]).toBeUndefined();
        expect(raidplan.removeObject(b, "auto", "t:r1:1")).toBe(b);
        expect(raidplan.setAutoScale(b, 5).autoScale).toBe(2);
        expect(raidplan.setAutoScale(b, 0.1).autoScale).toBe(0.4);
    });
});

describe("the plan uses the look", () => {
    it("each object's size is its own x the section's autoScale; the rest of its look goes along", () => {
        const b = board({ autoStyle: { "m:b:bt/illidan#1": { size: 96, opacity: 0.4 }, "t:r1:1": { size: 19, label: "Wand" } }, autoScale: 0.5 });
        const plan = auto.deriveAuto(ROWS, b, OPTS);
        expect(plan.mobs[0]).toMatchObject({ size: 48, style: { size: 96, opacity: 0.4 } });
        expect(plan.tanks[0]).toMatchObject({ size: 9.5, style: { label: "Wand" } });
        expect(plan.tanks[1].size).toBe(19);
    });

    it("the layout grows with the objects: bigger = further apart, still no overlap; smaller = closer", () => {
        const small = auto.deriveAuto(ROWS, board({ autoScale: 0.5 }), OPTS);
        const normal = auto.deriveAuto(ROWS, board(), OPTS);
        const big = auto.deriveAuto(ROWS, board({ autoScale: 2 }), OPTS);
        const gap = (p) => Math.abs(p.tanks[0].y - p.mobs[0].y);
        expect(gap(big)).toBeGreaterThan(gap(normal));
        expect(gap(small)).toBeLessThan(gap(normal));
        for (const p of [small, normal, big]) expect(noOverlap(p)).toBe(true);
        // a boss made 200 % on its own pushes its tank out, the board's symbol size on top too
        const bigBoss = auto.deriveAuto(ROWS, board({ autoStyle: { "m:b:bt/illidan#1": { size: 96 } } }), OPTS);
        expect(noOverlap(bigBoss)).toBe(true);
        const scaled = auto.deriveAuto(ROWS, board({ objectScale: 1.8 }), OPTS);
        expect(noOverlap(scaled, 1.8)).toBe(true);
    });
});

describe("the multi selection takes them along", () => {
    const at = { "t:r1:1": { x: 0.5, y: 0.6 }, "m:b:bt/illidan#1": { x: 0.5, y: 0.4 } };
    const b = board({ autoAt: at, icons: [{ id: "i1", iconKey: "enemy", x: 0.2, y: 0.2, size: 48, rotation: 0, label: "", showLabel: false, mobId: "", autoFace: true, opacity: 1, lock: false, hidden: false }] });

    it("Ctrl+A and the rubber band find them (not a hidden or locked one)", () => {
        const all = ms.selectableItems(b);
        expect(all).toEqual(expect.arrayContaining([{ kind: "auto", id: "t:r1:1" }, { kind: "auto", id: "m:b:bt/illidan#1" }, { kind: "icon", id: "i1" }]));
        const hidden = { ...b, autoStyle: { "t:r1:1": { hidden: true } } };
        expect(ms.selectableItems(hidden).some((x) => x.id === "t:r1:1")).toBe(false);
        expect(ms.hitObjects(b, { x0: 0.45, y0: 0.55, x1: 0.55, y1: 0.65 }, { w: 1000, h: 625 })).toEqual([{ kind: "auto", id: "t:r1:1" }]);
    });

    it("moving, scaling, opacity and deleting a selection with them", () => {
        const sel = [{ kind: "auto", id: "t:r1:1" }, { kind: "icon", id: "i1" }];
        const moved = ms.moveSelection(b, sel, 0.1, 0, { w: 1000, h: 625 });
        expect(moved.autoPos["t:r1:1"]).toEqual({ x: 0.6, y: 0.6 });
        expect(moved.icons[0].x).toBeCloseTo(0.3);
        const scaled = ms.scaleSelection(b, sel, 2, { x: 0.35, y: 0.4 });
        expect(scaled.autoStyle["t:r1:1"].size).toBe(76);
        expect(scaled.icons[0].size).toBe(96);
        const faded = ms.setLookSelection(b, sel, { opacity: 0.3 });
        expect(faded.autoStyle["t:r1:1"].opacity).toBe(0.3);
        const resized = ms.resizeSelection(b, sel, 0.5);
        expect(raidplan.objectPercent(resized, "auto", "t:r1:1")).toBe(50);
        // "delete" takes the icon, the auto object goes with its row only
        const gone = ms.deleteSelection(b, sel);
        expect(gone.icons).toEqual([]);
        expect(gone.autoStyle).toEqual({});
    });
});
