// Zoom and pan of a board (lib/boardView.ts): view only, the board points stay where they are.
const { loadTs } = require("./i18nHelper");

const bv = loadTs("lib/boardView.ts");
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
