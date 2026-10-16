// Text widths in the bundled font (utils/image/fontMetrics.js): the real font files under assets/fonts/.
const fs = require("fs");
const { FONT_FILES, parseFont, textWidth, fitText, fitSize } = require("../../../src/utils/image/fontMetrics");

describe("utils/image/fontMetrics", () => {
    it("bundles both weights and the licence", () => {
        expect(fs.existsSync(FONT_FILES.regular)).toBe(true);
        expect(fs.existsSync(FONT_FILES.bold)).toBe(true);
        expect(fs.readFileSync(require("path").join(FONT_FILES.regular, "..", "OFL.txt"), "utf8")).toContain("SIL Open Font License");
    });

    it("reads advance widths: narrow letters are narrower than wide ones, bold is wider", () => {
        expect(textWidth("iiii", 20)).toBeLessThan(textWidth("WWWW", 20));
        expect(textWidth("Hello", 20, { bold: true })).toBeGreaterThan(textWidth("Hello", 20));
        expect(textWidth("Hello", 40)).toBeCloseTo(textWidth("Hello", 20) * 2, 5);
        expect(textWidth("", 20)).toBe(0);
        expect(textWidth("ab", 20, { letterSpacing: 3 })).toBeCloseTo(textWidth("ab", 20) + 6, 5);
    });

    it("knows the German umlauts and accented names, and guesses a width for a glyph the font lacks", () => {
        const font = parseFont(fs.readFileSync(FONT_FILES.regular));
        for (const ch of ["ä", "ö", "ü", "ß", "é", "ñ", "Ø"]) expect(font.advance(ch.codePointAt(0))).toBeGreaterThan(0);
        expect(font.advance(0x1f600)).toBeUndefined();
        expect(textWidth("😀", 20)).toBeCloseTo(12, 5);
    });

    it("refuses a file that is not a TrueType font", () => {
        const junk = Buffer.alloc(64);
        expect(() => parseFont(junk)).toThrow(/TrueType/);
    });

    it("cuts a text to a width with an ellipsis, and leaves a short one alone", () => {
        expect(fitText("Zibbo", 500, 20)).toBe("Zibbo");
        const cut = fitText("Averyveryverylongname", 100, 20, { bold: true });
        expect(cut.endsWith("…")).toBe(true);
        expect(textWidth(cut, 20, { bold: true })).toBeLessThanOrEqual(100);
        expect(fitText("Wide", 1, 20)).toBe("");
    });

    it("finds the largest size at which a text fits, never below the minimum", () => {
        const size = fitSize("MAGTHERIDON", 100, 19, 11, { bold: true });
        expect(size).toBeLessThan(19);
        expect(textWidth("MAGTHERIDON", size, { bold: true })).toBeLessThanOrEqual(100);
        expect(fitSize("KARA", 100, 19, 11, { bold: true })).toBe(19);
        expect(fitSize("A very long tag that never fits", 20, 19, 11)).toBe(11);
    });
});
