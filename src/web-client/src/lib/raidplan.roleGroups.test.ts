// Group rings and role groups: names on a ring, a group's own token size,
// scaling with themselves and turned role groups (feature/raidplan-14..16).
// The board logic behind the editors (lib/raidplan.ts) runs for real; the
// stylesheet and board checks stay in test/web-client/raidplan.roleGroups.test.js.
import { describe, expect, it } from "vitest";
import * as lib from "./raidplan";

describe("names on a group ring (feature/raidplan-14)", () => {
    it("neighbours on a ring stand at least RING_CHORD tokens apart, whatever their number", () => {
        for (const n of [2, 3, 4, 5, 6, 8]) {
            const r = lib.ringRadius(n, 38);
            expect(2 * r * Math.sin(Math.PI / n)).toBeGreaterThanOrEqual(lib.RING_CHORD * 38 - 1e-9);
        }
        expect(lib.ringRadius(0, 38)).toBe(0);
        // few raiders keep the old minimum radius
        expect(lib.ringRadius(3, 38)).toBeCloseTo(38 * 1.7, 9);
    });

    it("a member's name is never wider than the room to its neighbour (and never more than 2.6 icons)", () => {
        for (const n of [2, 3, 5, 8]) {
            const w = lib.ringNameWidth(n, 38, 38);
            const chord = 2 * lib.ringRadius(n, 38) * Math.sin(Math.PI / n);
            expect(w).toBeLessThanOrEqual(chord - 38 * 0.25 + 1e-9);
            expect(w).toBeLessThanOrEqual(38 * 2.6);
        }
        expect(lib.ringNameWidth(1, 38, 38)).toBe(38 * 2.6);
        // members drawn bigger than the ring spacing: the name gets at least a little room
        expect(lib.ringNameWidth(5, 20, 60)).toBeGreaterThanOrEqual(60 * 1.2);
    });
});

describe("a group's own token size (feature/raidplan-15)", () => {
    it("the ring is laid out for the tokens it carries: never tighter than their size, the spacing wins when it is bigger", () => {
        expect(lib.ringUnit(38, 11)).toBe(38);
        expect(lib.ringUnit(11, 27)).toBe(27);
        expect(lib.ringUnit(0, 0)).toBe(0);
        // spacing 30 %, tokens 70 %: neighbours stand 2.2 tokens of 70 % apart, not of 30 %
        const r = lib.ringRadius(5, lib.ringUnit(38 * 0.3, 38 * 0.7));
        expect(2 * r * Math.sin(Math.PI / 5)).toBeGreaterThanOrEqual(lib.RING_CHORD * 38 * 0.7 - 1e-9);
    });
});

describe("role groups and group chips scale with themselves (feature/raidplan-15)", () => {
    it("a role group's icon, outline, label, count and names are shares of the zone: twice the zone, twice everything (within limits)", () => {
        const a = lib.roleZoneMetrics(100, 100, false, 0);
        const b = lib.roleZoneMetrics(200, 200, false, 0);
        expect(b.icon / a.icon).toBeCloseTo(2, 5);
        expect(b.label).toBeGreaterThan(a.label);
        expect(b.border).toBeGreaterThan(a.border);
        expect(b.names).toBeGreaterThan(a.names);
        // the icon is a circle of the zone's smaller side: a narrow strip gets an undistorted, smaller icon
        const strip = lib.roleZoneMetrics(50, 250, false, 0);
        expect(strip.icon).toBeLessThanOrEqual(50 * 0.45 + 1e-9);
        // names go by the area: the strip still has readable names, never more than a token name (11.4)
        expect(strip.names).toBeGreaterThan(8);
        expect(lib.roleZoneMetrics(900, 900, false, 0).names).toBe(11.4);
        expect(lib.roleZoneMetrics(900, 900, false, 0).icon).toBe(96);
        // limits of the outline
        expect(lib.roleZoneMetrics(10, 10, false, 0).border).toBe(1);
        expect(lib.roleZoneMetrics(900, 900, false, 0).border).toBe(4);
        // a cluster: several smaller icons
        expect(lib.roleZoneMetrics(200, 200, true, 5).icon).toBeLessThan(lib.roleZoneMetrics(200, 200, false, 0).icon);
    });

    it("a zone's edge grips move one side only; the corners two", () => {
        const r = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
        expect(lib.resizeRect(r, "e", 0.1, 0.3)).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.3, 9), h: 0.2 });
        expect(lib.resizeRect(r, "s", 0.3, 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.2, h: expect.closeTo(0.3, 9) });
        expect(lib.resizeRect(r, "n", 0, -0.1).y).toBeCloseTo(0.1, 9);
        expect(lib.resizeRect(r, "w", -0.1, 0).x).toBeCloseTo(0.1, 9);
        expect(lib.resizeRect(r, "se", 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.3, 9), h: expect.closeTo(0.3, 9) });
    });

    it("a group chip: automatic width (0) or the width set for it, 60 .. 400", () => {
        expect(lib.chipWidthOf({})).toBe(0);
        expect(lib.chipWidthOf({ chipWidth: 0 })).toBe(0);
        expect(lib.chipWidthOf({ chipWidth: 30 })).toBe(60);
        expect(lib.chipWidthOf({ chipWidth: 150.4 })).toBe(150);
        expect(lib.chipWidthOf({ chipWidth: 999 })).toBe(400);
    });
});

describe("role groups turned, their names inside (feature/raidplan-16)", () => {
    it("the upright box of a turned zone: a rectangle, and an ellipse (smaller)", () => {
        expect(lib.turnedBox(100, 20, 0)).toEqual({ w: 100, h: 20 });
        const r = lib.turnedBox(100, 20, 90);
        expect(r.w).toBeCloseTo(20, 6);
        expect(r.h).toBeCloseTo(100, 6);
        const d = lib.turnedBox(100, 20, 45);
        expect(d.w).toBeCloseTo(120 / Math.SQRT2, 6);
        const e = lib.turnedBox(100, 20, 45, "ellipse");
        expect(e.w).toBeLessThan(d.w);
        expect(lib.turnedBox(100, 100, 45, "ellipse").w).toBeCloseTo(100, 6);
    });

    it("the area for the content stays upright: swapped on its side, a square when turned diagonally, inside an ellipse", () => {
        expect(lib.uprightInner(40, 200, 0)).toEqual({ w: 40, h: 200 });
        expect(lib.uprightInner(40, 200, 90)).toEqual({ w: 200, h: 40 });
        expect(lib.uprightInner(40, 200, 180)).toEqual({ w: 40, h: 200 });
        expect(lib.uprightInner(40, 200, 45).w).toBeCloseTo(40 * 0.78, 6);
        expect(lib.uprightInner(100, 100, 0, "ellipse").w).toBeCloseTo(70, 6);
    });

    it("names inside: as many as fit, the rest one '+N' chip; the font scales with the area, at most 11.4", () => {
        const names = ["Schleich", "Meuchler", "Schatten", "Berserker", "Richter", "Donnerfaust", "Klingentanz", "Katzenauge"];
        const big = lib.roleNamesLayout(300, 300, names, 1);
        expect(big.shown).toBe(8);
        expect(big.more).toBe(0);
        expect(big.font).toBe(11.4);
        const small = lib.roleNamesLayout(60, 45, names, 1);
        expect(small.shown).toBeLessThan(8);
        expect(small.shown + small.more).toBe(8);
        expect(small.font).toBeLessThan(big.font);
        // no room at all: nothing shown, all counted
        expect(lib.roleNamesLayout(10, 10, names, 1)).toMatchObject({ shown: 0, more: 8 });
        // the symbol's own scale on top of the automatic size
        expect(lib.roleNamesLayout(300, 300, names, 2).icon).toBeCloseTo(lib.roleNamesLayout(300, 300, names, 1).icon * 2, 5);
    });

    it("a turned zone resized at an edge grip: along its own axis, the opposite side stays", () => {
        const start = { x: 0.4, y: 0.1, w: 0.1, h: 0.5 };
        const W = 1000;
        const H = 625;
        // not turned: like resizeRect
        const flat = lib.resizeTurned(start, "s", 0, 50, 0, W, H);
        expect(flat.h).toBeCloseTo(0.5 + 50 / H, 6);
        expect(flat.y).toBeCloseTo(0.1, 6);
        // turned 90 degrees: "s" (its own bottom) points to the left of the board - a move left makes it longer
        const t = lib.resizeTurned(start, "s", -50, 0, 90, W, H);
        expect(t.h * H).toBeCloseTo(0.5 * H + 50, 4);
        // the far end (its top, on the board: the right end) stays where it was
        const farBefore = { x: (0.45) * W + (0.25 * H) * 1, y: 0.35 * H };
        const cx = (t.x + t.w / 2) * W;
        const farAfter = { x: cx + (t.h * H) / 2, y: (t.y + t.h / 2) * H };
        expect(farAfter.x).toBeCloseTo(farBefore.x, 3);
        expect(farAfter.y).toBeCloseTo(farBefore.y, 3);
    });
});
