// How the facing wedge of an icon is drawn (the stylesheet and PlanBoard); the logic of the wedge and of the role group
// placeholder is tested in src/web-client/src/lib/arrowRoleGroup.test.ts.

const { read } = require("../clientSource"); // inlines the @imports of a stylesheet (#441)

describe("the facing wedge of one icon", () => {
    it("is drawn in reference units: the wedge's size and its air to the icon grow with --rp-ar (editor, template and sheet share the board)", () => {
        const css = read("styles/raidplan/index.css");
        expect(css).toMatch(/\.rp-canvas \.rp-wedge \{ width: calc\(var\(--rp-s, 48px\) \* \.46 \* var\(--rp-ar, 1\)\); height: calc\(var\(--rp-s, 48px\) \* \.42 \* var\(--rp-ar, 1\)\);.*top: calc\(var\(--rp-s, 48px\) \* -\.5 - var\(--rp-s, 48px\) \* \.52 \* var\(--rp-ar, 1\)\)/);
        const pb = read("components/raidplan/PlanBoard.tsx");
        expect(pb).toContain("...arrowVars(i)");
        expect(pb).toContain("...arrowVars(st)");
        expect(pb).toContain("o.arrowHidden ? null");
    });
});
