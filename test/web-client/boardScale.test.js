// The board's coordinate space (lib/boardScale.ts): one reference width, one scale factor.
const { loadTs } = require("./i18nHelper");
const bs = loadTs("lib/boardScale.ts");

describe("board scale", () => {
    it("scales the canvas with ONE factor: width / reference width, the same for every content", () => {
        expect(bs.boardScale(0)).toBe(0);
        expect(bs.boardScale(bs.REF_W)).toBe(1);
        expect(bs.boardScale(bs.REF_W * 2)).toBe(2);
        const a = bs.canvasStyle(1083, 1.6);
        const b = bs.canvasStyle(1697, 1.6);
        expect(a.width).toBe(bs.REF_W);
        expect(a.height).toBe(b.height);
        expect(a.transform).toBe(`scale(${1083 / bs.REF_W})`);
        expect(b["--rp-k"]).toBe(String(1697 / bs.REF_W));
    });
    it("the height follows the map's aspect, never the container; no aspect = 16:10", () => {
        expect(bs.refHeight(2)).toBe(bs.REF_W / 2);
        expect(bs.refHeight(0)).toBe(bs.REF_W / 1.6);
    });
});
