// The board's coordinate space (lib/raidplan/boardScale.ts): one reference width, one scale factor.
import { describe, expect, it } from "vitest";
import * as bs from "./boardScale";

describe("board scale", () => {
    it("scales the canvas with ONE factor: width / reference width, the same for every content", () => {
        expect(bs.boardScale(0)).toBe(0);
        expect(bs.boardScale(bs.REF_W)).toBe(1);
        expect(bs.boardScale(bs.REF_W * 2)).toBe(2);
        const a = bs.canvasStyle(1083, 677, 1.6, 1, 0, 0);
        const b = bs.canvasStyle(1697, 1060, 1.6, 1, 0, 0);
        expect(a.width).toBe(bs.REF_W);
        expect(a.height).toBe(b.height);
        expect(a.transform).toBe(`translate(0px, 0px) scale(${1083 / bs.REF_W})`);
        expect(b["--rp-k"]).toBe(String(1697 / bs.REF_W));
    });
    it("zoom and pan enlarge and move the same canvas: the scale is multiplied, the offset is a share of the frame", () => {
        const z = bs.canvasStyle(700, 437.5, 1.6, 2, -0.5, -0.25);
        expect(z.transform).toBe("translate(-350px, -109.375px) scale(2)");
        expect(z["--rp-k"]).toBe("2");
    });
    it("the height follows the map's aspect, never the container; no aspect = 16:10", () => {
        expect(bs.refHeight(2)).toBe(bs.REF_W / 2);
        expect(bs.refHeight(0)).toBe(bs.REF_W / 1.6);
    });
});
