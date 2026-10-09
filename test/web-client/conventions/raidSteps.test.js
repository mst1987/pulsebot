// Das Raid-Cockpit (#319): what a render cannot see — the bar holds no step
// list or rule of its own (the server decides), and the CSS keeps a skipped
// step quiet and collapses the bar to one line on a phone instead of
// scrolling sideways. The bar is rendered in Vitest
// (src/web-client/src/pages/raid-detail/StepBar.test.tsx, RaidDetailPage.steps.test.tsx),
// its words in lib/raids/raidSteps.test.ts.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("step bar conventions", () => {
    const bar = read("pages", "raid-detail", "StepBar.tsx");
    const css = read("styles", "raid-detail.css");

    it("draws the route the server sent, never one of its own", () => {
        expect(bar).not.toMatch(/"Angelegt"|"Nachbereitung"|"Freigabe"/);
        expect(bar).not.toMatch(/signupDeadline|autoSuggest|ownSetup/);
    });

    it("marks the open step and says „übersprungen“ quietly — no red, no strike-through", () => {
        expect(css).toMatch(/\n\.rd-ck\.current \{/);
        const skipped = css.match(/\.rd-ck\.state-skipped \{([^}]*)\}/)[1];
        expect(skipped).toMatch(/opacity/);
        expect(skipped).not.toMatch(/line-through|--bad|red/);
    });

    it("is one row of equal steps, each two lines (name over value), with a strip for the open step's deed", () => {
        expect(css).toMatch(/\n\.rd-ck-steps \{[^}]*display: flex/);
        expect(css).toMatch(/\n\.rd-ck-steps > li \{[^}]*flex: 1 1 0;/);
        // icon | name | mark on top, the value below name and mark: neither is cut short for the other
        expect(css).toMatch(/\n\.rd-ck \{[^}]*display: grid;[^}]*grid-template-rows: auto auto/);
        expect(css).toMatch(/\n\.rd-ck-val \{[^}]*grid-row: 2; grid-column: 2 \/ span 2;/);
        expect(css).toMatch(/\n\.rd-ck-focus \{/);
    });

    it("collapses to one line plus the strip on a phone instead of scrolling sideways", () => {
        const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
        expect(narrow).toContain(".rd-ck-sum { display: block; }");
        // with something open: "Schritt 5 von 6 · Einteilungen" and the strip with its full-width button; else all steps, two a row
        expect(narrow).toContain(".rd-cockpit.has-focus .rd-ck-steps { display: none; }");
        expect(narrow).toMatch(/\.rd-ck-focus \.btn \{ flex: 1 1 100%;[^}]*min-height: 44px/);
        expect(narrow).toContain(".rd-ck-steps > li { flex: 1 1 50%;");
        expect(css).not.toMatch(/\.rd-c[k]?[a-z-]*\s*\{[^}]*overflow-x/);
    });
});
