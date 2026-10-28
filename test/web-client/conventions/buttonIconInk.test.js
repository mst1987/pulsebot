// A glyph of the app's own icon set (#951) sits in its area tone (blood,
// bronze, arcane, fel). On a filled button that was unreadable — a red
// silhouette on the blue primary "Raid-Event anlegen". Inside a button the
// glyph takes the button's ink instead; brand marks keep their colours.
const css = require("../clientSource").read("index.css");

describe("button icon ink", () => {
    it("draws own glyphs in the button's text colour", () => {
        const rule = css.match(/\n\.btn \.wi\.uic:not\(\.uic-brand\) \{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toContain("color: currentColor");
    });

    it("comes after the tone classes, so it is not overridden by them", () => {
        expect(css.indexOf(".btn .wi.uic:not(.uic-brand)")).toBeGreaterThan(css.indexOf(".uic-fel {"));
    });
});
