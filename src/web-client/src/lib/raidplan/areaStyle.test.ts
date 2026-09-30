// The two styles of a role group area (#559): the style and its defaults (the client twin of raidplanBoard.cleanAreaStyle), the band of an
// arc, and where its badge and names stand.
import { describe, expect, it } from "vitest";
import { arcBand, arcLayout, arcOffset, arcPath, arcSpanOf, arcWidthOf, areaBadgeMetrics, areaStyleOf, calmBadgeAt, roleNamesLayout } from "./roleGroups";

describe("the style of a role group area", () => {
    it("is calm unless set to arc; a cluster of symbols is never an arc", () => {
        expect(areaStyleOf({})).toBe("calm");
        expect(areaStyleOf({ areaStyle: "weird" })).toBe("calm");
        expect(areaStyleOf({ areaStyle: "arc", shape: "ellipse" })).toBe("arc");
        expect(areaStyleOf({ areaStyle: "arc", shape: "cluster" })).toBe("calm");
    });
    it("the arc's span and band width: stored and clamped, else a ring for melee / tanks and a half ring for the others", () => {
        expect(arcSpanOf({ role: "melee" })).toBe(360);
        expect(arcSpanOf({ role: "tank" })).toBe(360);
        expect(arcSpanOf({ role: "ranged" })).toBe(180);
        expect(arcSpanOf({ arcSpan: 5 })).toBe(30);
        expect(arcSpanOf({ arcSpan: 999 })).toBe(360);
        expect(arcSpanOf({ arcSpan: 120.4 })).toBe(120);
        expect(arcWidthOf({})).toBe(0.35);
        expect(arcWidthOf({ arcWidth: 2 })).toBe(0.8);
        expect(arcWidthOf({ arcWidth: 0.01 })).toBe(0.1);
    });
});

describe("the band of an arc", () => {
    it("lies inside the zone, its width a share of the smaller half axis, its middle pointing down", () => {
        const b = arcBand(400, 200, 180, 0.5);
        expect(b).toMatchObject({ rx: 200, ry: 100, t: 50, irx: 150, iry: 50, a0: 0, a1: 180, ring: false });
        expect(arcBand(300, 300, 360, 0.35).ring).toBe(true);
    });
    it("a ring is two closed ellipses, an arc one annulus sector", () => {
        expect(arcPath(200, 200, 360, 0.3).match(/M /g)).toHaveLength(2);
        const d = arcPath(200, 200, 180, 0.3);
        expect(d.match(/M /g)).toHaveLength(1);
        // a half ring from the right (200 100) through the bottom to the left, then back on the inner edge
        expect(d.startsWith("M 200 100 A 100 100 0 0 1 0 100")).toBe(true);
        expect(arcPath(200, 200, 270, 0.3)).toContain(" 0 1 1 ");
    });
    it("a point on it turns with the zone", () => {
        expect(arcOffset(100, 50, 90, 0)).toEqual({ dx: 0, dy: 50 });
        const p = arcOffset(100, 50, 90, 90);
        expect(p.dx).toBeCloseTo(-50);
        expect(p.dy).toBeCloseTo(0);
    });
});

describe("the badge and the names of an arc", () => {
    it("the badge at the top of a ring and in the middle of an arc, on the outer edge", () => {
        expect(arcLayout(300, 300, 360, 0.35, 0, [], 60).badge).toEqual({ dx: 0, dy: -150 });
        expect(arcLayout(300, 300, 180, 0.35, 0, [], 60).badge).toEqual({ dx: 0, dy: 150 });
    });
    it("the names on the middle of the band, clear of the badge, in order", () => {
        const lay = arcLayout(300, 300, 360, 0.35, 0, ["Kargoth", "Vexa", "Brann"], 60);
        expect(lay.shown).toBe(3);
        expect(lay.more).toBe(0);
        const mid = 150 - (150 * 0.35) / 2;
        for (const s of lay.spots) expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(mid, 0);
        // none of them where the badge is (the top)
        for (const s of lay.spots) expect(s.dy > -mid + 5 || Math.abs(s.dx) > 30).toBe(true);
        // clockwise from the badge: the first one on the right, the last one on the left
        expect(lay.spots[0].dx).toBeGreaterThan(0);
        expect(lay.spots[2].dx).toBeLessThan(0);
    });
    it("what does not fit is one +N chip at the end, never silently gone", () => {
        const names = Array.from({ length: 30 }, (_, i) => `Raider${i}`);
        const lay = arcLayout(160, 160, 90, 0.3, 0, names, 50);
        expect(lay.shown).toBeLessThan(30);
        expect(lay.shown + lay.more).toBe(30);
        expect(lay.spots).toHaveLength(lay.shown + 1);
    });
    it("the badge scales with the zone and the symbol size", () => {
        const a = areaBadgeMetrics(100, 100);
        expect(areaBadgeMetrics(150, 150).font).toBeGreaterThan(a.font);
        expect(areaBadgeMetrics(100, 100, 2).font).toBeCloseTo(a.font * 2, 0);
        expect(a.icon).toBeGreaterThan(a.font);
    });
    it("a calm badge sits centred on the edge that lies on top, also when the area is turned", () => {
        expect(calmBadgeAt(200, 100, 0)).toEqual({ dx: 0, dy: -50 });
        // on its side: the upper short edge
        const side = calmBadgeAt(200, 40, 90);
        expect(side.dx).toBeCloseTo(0);
        expect(side.dy).toBeCloseTo(-100);
        // turned a little: still the middle of its own top edge, a bit off to the right
        const tilt = calmBadgeAt(200, 100, 30);
        expect(tilt.dx).toBeCloseTo(25);
        expect(tilt.dy).toBeCloseTo(-43.3, 1);
    });
    it("names that do not fit the arc get a smaller font first (down to 60 %)", () => {
        const few = arcLayout(300, 300, 360, 0.35, 0, ["Kargoth"], 60);
        const many = arcLayout(300, 300, 360, 0.35, 0, Array.from({ length: 12 }, (_, i) => `Raider${i}`), 60);
        expect(many.font).toBeLessThan(few.font);
        expect(many.font).toBeGreaterThanOrEqual(few.font * 0.6 - 0.1);
    });
    it("calm names have the whole inner area (no symbol above them)", () => {
        expect(roleNamesLayout(200, 100, ["A"], 1, false).icon).toBe(0);
        expect(roleNamesLayout(200, 100, ["A"], 1).icon).toBeGreaterThan(0);
    });
});
