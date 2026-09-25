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
    it("the ratio to the icon never changes with the zoom: too small on screen = hidden, never enlarged (names lay on the next raider)", () => {
        // a 38-unit icon at every zoom: always 11.4 units, whatever the board's scale on screen
        for (const scale of [0.2, 0.36, 0.58, 1, 3]) {
            const m = ls.labelMetrics(38, ls.NAME_FACTOR, scale);
            expect(m.font).toBeCloseTo(38 * ls.NAME_FACTOR, 9);
            expect(m.clamped).toBe(false);
        }
        // 11.4 units x 0.3 px per unit = 3.4 px on screen: hidden
        expect(ls.labelMetrics(38, ls.NAME_FACTOR, 0.3).show).toBe(false);
        // 11.4 x 0.5 = 5.7 px: shown, at its share
        expect(ls.labelMetrics(38, ls.NAME_FACTOR, 0.5).show).toBe(true);
        // a big icon on a small board: shown
        expect(ls.labelMetrics(152, ls.NAME_FACTOR, 0.15).show).toBe(true);
        expect(ls.labelMetrics(38, ls.NAME_FACTOR, 0).show).toBe(true);
    });
});

describe("effects round an icon scale with the icon (effectMetrics)", () => {
    it("ring, glow, selection glow, shadow and outline are constant shares of the icon size at every size", () => {
        for (const size of [8, 19, 38, 76, 152]) {
            const e = ls.effectMetrics(size);
            expect(e.ring / size).toBeCloseTo(ls.RING_FACTOR, 6);
            expect(e.glow / size).toBeCloseTo(ls.GLOW_FACTOR, 6);
            expect(e.spread / size).toBeCloseTo(ls.GLOW_SPREAD_FACTOR, 6);
            expect(e.select / size).toBeCloseTo(ls.SELECT_GLOW_FACTOR, 6);
            expect(e.shadow / size).toBeCloseTo(ls.SHADOW_FACTOR, 6);
            expect(e.outline / size).toBeCloseTo(ls.OUTLINE_FACTOR, 6);
        }
    });
    it("a size of nothing has no effects, a negative size never draws a negative width", () => {
        expect(ls.effectMetrics(0)).toEqual({ ring: 0, glow: 0, spread: 0, select: 0, shadow: 0, outline: 0 });
        expect(ls.effectMetrics(-5).glow).toBe(0);
    });
    it("the stylesheet draws the me-glow, the selection glow and the shadows of the canvas from those variables, not from fixed px", () => {
        const css = require("fs").readFileSync(require("path").join(__dirname, "../../src/web-client/src/styles/raidplan.css"), "utf8");
        for (const rule of [".rp-canvas .rp-token.is-me .rp-ico {", "@keyframes rp-pulse-s", ".rp-canvas .rp-token.is-selected .rp-ico"]) {
            const at = css.indexOf(rule);
            expect(at).toBeGreaterThan(-1);
            const body = css.slice(at, css.indexOf("}", at));
            expect(body).toMatch(/var\(--rp-(ring|glow|sel)/);
        }
    });
});
