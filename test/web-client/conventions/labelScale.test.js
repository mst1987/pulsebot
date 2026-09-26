// The stylesheet draws the effects round an icon from the variables of lib/raidplan/labelScale.ts; the logic of lib/raidplan/labelScale.ts is
// tested in src/web-client/src/lib/labelScale.test.ts.

describe("effects round an icon scale with the icon (effectMetrics)", () => {
    it("the stylesheet draws the me-glow, the selection glow and the shadows of the canvas from those variables, not from fixed px", () => {
        const css = require("fs").readFileSync(require("path").join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
        for (const rule of [".rp-canvas .rp-token.is-me .rp-ico {", "@keyframes rp-pulse-s", ".rp-canvas .rp-token.is-selected .rp-ico"]) {
            const at = css.indexOf(rule);
            expect(at).toBeGreaterThan(-1);
            const body = css.slice(at, css.indexOf("}", at));
            expect(body).toMatch(/var\(--rp-(ring|glow|sel)/);
        }
    });
});
