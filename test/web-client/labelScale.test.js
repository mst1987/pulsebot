// The name label follows the icon's size (lib/labelScale.ts).
const { loadTs } = require("./i18nHelper");

const ls = loadTs("lib/labelScale.ts");

describe("label metrics", () => {
    it("the font is a fixed share of the icon at any factor: 40 %, 100 % and 200 % keep the ratio", () => {
        for (const f of [0.4, 1, 2]) {
            const size = 38 * f;
            const m = ls.labelMetrics(size, ls.NAME_FACTOR, 2);
            expect(m.font / size).toBeCloseTo(ls.NAME_FACTOR, 9);
            expect(m.show).toBe(true);
            expect(m.clamped).toBe(false);
        }
    });
    it("the zoom and the board scale multiply the font on screen, not the ratio to the icon", () => {
        const a = ls.labelMetrics(38, ls.NAME_FACTOR, 1);
        const b = ls.labelMetrics(38, ls.NAME_FACTOR, 2);
        expect(a.font).toBe(b.font);
        expect(b.font * 2).toBeCloseTo(a.font * 2, 9);
    });
    it("an icon (bigger default) uses a smaller share", () => {
        expect(ls.labelMetrics(48, ls.ICON_NAME_FACTOR, 1).font).toBeCloseTo(11.52, 9);
    });
    it("below the legibility limit the font stops shrinking, and a label that would then dwarf its icon is hidden", () => {
        // a 38-unit icon at 0.3 px per unit: font 11.4 units = 3.4 px on screen -> clamped to 7 px = 23.3 units, wider than 2.2 icons
        const tiny = ls.labelMetrics(38, ls.NAME_FACTOR, 0.3);
        expect(tiny.clamped).toBe(true);
        expect(tiny.font).toBeCloseTo(7 / 0.3, 9);
        expect(tiny.show).toBe(false);
        // clamped but the label still fits (a big icon on a small board): shown at the minimum
        const ok = ls.labelMetrics(152, ls.NAME_FACTOR, 0.15);
        expect(ok.clamped).toBe(true);
        expect(ok.show).toBe(true);
        expect(ls.labelMetrics(38, ls.NAME_FACTOR, 0).show).toBe(true);
    });
});
