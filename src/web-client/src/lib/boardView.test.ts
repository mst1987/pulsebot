// Zoom and pan of a board (lib/boardView.ts): view only, the board points stay where they are.
import { describe, expect, it } from "vitest";
import * as bv from "./boardView";

const close = (a, b) => expect(a).toBeCloseTo(b, 9);

describe("limits", () => {
    it("zoom is kept between 50 % and 400 %", () => {
        expect(bv.clampZoom(0.1)).toBe(0.5);
        expect(bv.clampZoom(9)).toBe(4);
        expect(bv.clampZoom(NaN)).toBe(1);
        expect(bv.FIT).toEqual({ z: 1, ox: 0, oy: 0 });
    });
    it("zoomed in the picture cannot leave the frame, zoomed out it sits in the middle", () => {
        expect(bv.clampView({ z: 2, ox: 0.4, oy: -3 })).toEqual({ z: 2, ox: 0, oy: -1 });
        expect(bv.clampView({ z: 2, ox: -0.5, oy: -0.5 })).toEqual({ z: 2, ox: -0.5, oy: -0.5 });
        expect(bv.clampView({ z: 0.5, ox: 0.9, oy: -0.2 })).toEqual({ z: 0.5, ox: 0.25, oy: 0.25 });
    });
});

describe("zoom to the pointer", () => {
    it("the board point under the pointer stays under it", () => {
        const v = { z: 1, ox: 0, oy: 0 };
        const w = 800;
        const h = 500;
        const p = { x: 300, y: 120 };
        const before = bv.screenToBoard(v, p.x, p.y, 0, 0, w, h);
        const z2 = bv.zoomAt(v, 2.5, p.x / w, p.y / h);
        const after = bv.screenToBoard(z2, p.x, p.y, 0, 0, w, h);
        close(after.bx, before.bx);
        close(after.by, before.by);
        expect(z2.z).toBe(2.5);
    });
    it("zooming at a corner stays clamped (no gap) and zooming back to fit restores the origin", () => {
        const v = bv.zoomAt({ z: 1, ox: 0, oy: 0 }, 3, 1, 1);
        expect(v.ox).toBeCloseTo(-2, 9);
        expect(v.oy).toBeCloseTo(-2, 9);
        const back = bv.zoomAt(v, 1, 0.5, 0.5);
        expect(back).toEqual({ z: 1, ox: 0, oy: 0 });
    });
    it("screen and board convert both ways at any zoom and pan, a frame that is not at the window's origin included", () => {
        const v = { z: 2.2, ox: -0.7, oy: -0.4 };
        for (const [bx, by] of [[0.1, 0.9], [0.5, 0.5], [0.83, 0.02]]) {
            const s = bv.boardToScreen(v, bx, by, 240, 96, 1000, 600);
            const b = bv.screenToBoard(v, s.x, s.y, 240, 96, 1000, 600);
            close(b.bx, bx);
            close(b.by, by);
        }
    });
});

describe("pan, wheel, buttons and pinch", () => {
    it("pans by a distance of the frame and stays inside", () => {
        expect(bv.panBy({ z: 2, ox: -0.5, oy: -0.5 }, 0.2, -0.2)).toEqual({ z: 2, ox: -0.3, oy: -0.7 });
        expect(bv.panBy({ z: 2, ox: -0.5, oy: -0.5 }, 5, 5)).toEqual({ z: 2, ox: 0, oy: 0 });
        expect(bv.panBy({ z: 1, ox: 0, oy: 0 }, 0.3, 0.3)).toEqual({ z: 1, ox: 0, oy: 0 });
    });
    it("the wheel zooms smoothly (up = in) and the buttons step by a quarter", () => {
        expect(bv.wheelZoom(1, -100)).toBeGreaterThan(1);
        expect(bv.wheelZoom(1, 100)).toBeLessThan(1);
        expect(bv.wheelZoom(3.9, -1000)).toBe(4);
        expect(bv.stepZoom(1, 1)).toBe(1.25);
        expect(bv.stepZoom(1.25, -1)).toBe(1);
        expect(bv.stepZoom(4, 1)).toBe(4);
        expect(bv.stepZoom(0.5, -1)).toBe(0.5);
    });
    it("a pinch zooms by the ratio about its centre and follows the centre's move", () => {
        const v = bv.pinchView({ z: 1, ox: 0, oy: 0 }, 0.2, 0.5, 0.5, 0.4, 0.5, 0.5);
        expect(v.z).toBe(2);
        close(v.ox, -0.5);
        const moved = bv.pinchView({ z: 2, ox: -0.5, oy: -0.5 }, 0.2, 0.5, 0.5, 0.2, 0.6, 0.5);
        expect(moved).toEqual({ z: 2, ox: -0.4, oy: -0.5 });
        expect(bv.pinchView({ z: 2, ox: -0.5, oy: -0.5 }, 0, 0.5, 0.5, 0.3, 0.5, 0.5)).toEqual({ z: 2, ox: -0.5, oy: -0.5 });
    });
});

describe("saved default view", () => {
    it("centre and visible rectangle agree, the centre is where the frame's middle is", () => {
        const v = bv.centerOn(2.5, 0.3, 0.6);
        const c = bv.centerOf(v);
        close(c.cx, 0.3);
        close(c.cy, 0.6);
        const r = bv.visibleRect(v);
        close(r.w, 0.4);
        close(r.x + r.w / 2, 0.3);
        expect(bv.visibleRect(bv.FIT)).toMatchObject({ w: 1, h: 1 });
    });
    it("a centre near the edge is kept inside the picture (no gap)", () => {
        const v = bv.centerOn(2, 0.02, 0.98);
        const r = bv.visibleRect(v);
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    });
    it("stores nothing for the whole picture, rounds the rest, and opens the same view again", () => {
        expect(bv.savedView(bv.FIT)).toBe(null);
        expect(bv.savedView({ z: 0.7, ox: 0.15, oy: 0.15 })).toBe(null);
        const s = bv.savedView(bv.centerOn(2.5, 0.3, 0.6));
        expect(s).toEqual({ zoom: 2.5, cx: 0.3, cy: 0.6 });
        const back = bv.viewFromSaved(s);
        close(bv.centerOf(back).cx, 0.3);
        expect(back.z).toBe(2.5);
    });
    it("an unusable saved view opens the whole picture", () => {
        expect(bv.viewFromSaved(null)).toEqual(bv.FIT);
        expect(bv.viewFromSaved({ zoom: 1, cx: 0.5, cy: 0.5 })).toEqual(bv.FIT);
        expect(bv.viewFromSaved({ zoom: 2, cx: NaN, cy: 0.5 })).toEqual(bv.FIT);
        expect(bv.viewFromSaved({ zoom: 99, cx: 5, cy: -1 }).z).toBe(4);
    });
});
