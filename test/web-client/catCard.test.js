// Guards for the per-category settings card (Einstellungen → Kategorien):
// src/web-client/src/components/CategoryMatrix.tsx + the .catcard rules in
// index.css.
//
// The card had grown five unrelated spacings (a .field margin stacked on the
// grid gap, an inline marginTop on the sheet-name input, three different
// paddings), and the roles were 28px lines with the checkbox riding above the
// name. What is worth protecting is that the spacing comes from one place and
// that the pieces the card relies on stay in the stylesheet.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const css = fs.readFileSync(path.join(CLIENT, "index.css"), "utf8");
const matrix = fs.readFileSync(path.join(CLIENT, "components", "CategoryMatrix.tsx"), "utf8");

function rule(selector) {
    const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
}

describe("Kategorien card layout", () => {
    it("spaces the card from the stylesheet, never inline", () => {
        // The sheet-name input used to carry style={{ marginTop: 6 }} — a
        // spacing no token knows about. Stacked inputs sit in .catcard-stack.
        expect(matrix).not.toContain("style={{");
        expect(matrix).toContain('className="catcard-stack"');
        expect(rule(".catcard-stack")).toContain("gap: 8px");
    });

    it("drops the generic .field margin inside the card so the grid gap is the only spacing", () => {
        // .field's margin-bottom used to add to .catcard-body's gap: 30px
        // between the roles and the loot-tool row, 7px between a label and
        // its input.
        expect(rule(".catcard-body .field")).toMatch(/margin: 0/);
        expect(rule(".catcard-body")).toContain("gap: 20px");
        expect(rule(".catcard-grid")).toContain("gap: 20px");
    });

    it("titles the card's blocks with the kicker style the rest of the admin uses", () => {
        const label = rule(".catcard-body .field > label");
        expect(label).toContain("var(--font-mono)");
        expect(label).toContain("text-transform: uppercase");
        expect(label).toContain("margin-bottom: 8px");
    });

    it("gives a role row a 36px hit target with the checkbox centred on the name", () => {
        const box = rule(".catcard-body .rolebox");
        expect(box).toContain("min-height: 36px");
        expect(box).toContain("align-items: center");
        // The name is wrapped so it can ellipsise instead of wrapping under the box.
        expect(matrix).toContain("<span>@{r.name}</span>");
    });

    it("marks an active card so it can carry the panel corner, and dims an inactive one", () => {
        expect(matrix).toContain('className={`catcard${active ? " is-on" : ""}`}');
        expect(rule(".catcard.is-on")).toContain("clip-path: polygon(");
        expect(css).toContain(".catcard.is-on::after");
        expect(rule(".catcard-head.is-off b")).toContain("color: var(--muted)");
    });

    it("keeps hint lines readable", () => {
        expect(rule(".catcard-body .hint")).toContain("max-width: 56ch");
    });
});
