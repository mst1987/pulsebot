// Das Raid-Cockpit (#319): what a render cannot see — the bar holds no step
// list or rule of its own (the server decides), and the CSS keeps a skipped
// step quiet and collapses the bar to one line on a phone instead of
// scrolling sideways. The bar is rendered in Vitest
// (src/web-client/src/pages/raid-detail/StepBar.test.tsx, RaidDetailPage.steps.test.tsx),
// its words in lib/raidSteps.test.ts.
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

    it("collapses to one line on a phone instead of scrolling sideways", () => {
        const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
        expect(narrow).toContain(".rd-ck-sum { display: block; }");
        expect(narrow).toContain(".rd-ck-steps { grid-template-columns: 1fr; }");
        expect(narrow).toContain(".rd-ck-steps:has(> li.is-current) > li:not(.is-current) { display: none; }");
        expect(css).not.toMatch(/\.rd-c[k]?[a-z-]*\s*\{[^}]*overflow-x/);
    });
});
