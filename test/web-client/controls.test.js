// Guards for the admin client's shared control system (src/web-client/src/index.css).
//
// These are style rules, so there is no behaviour to call — what is worth
// protecting are the invariants that break silently and only show up as a
// crooked filter row or an invisible dropdown arrow in one theme:
//   * every theme block carries its own chevron (a data URI cannot read a
//     custom property, so the light theme has to restate it),
//   * the controls that share a line take their height from the same token
//     instead of each hardcoding its own px value,
//   * the filter bars use the shared class rather than re-inlining the layout.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const css = fs.readFileSync(path.join(CLIENT, "index.css"), "utf8");

// The blocks that define the palette: :root (dark) plus the two the light theme
// needs — the prefers-color-scheme one and the explicit [data-theme="light"].
function themeBlocks() {
    return css
        .split(/\n(?=:root|@media|\S)/)
        .filter((block) => block.includes("--accent:"));
}

describe("web-client control styles", () => {
    it("gives every theme its own select chevron", () => {
        const blocks = themeBlocks();
        expect(blocks.length).toBe(3);
        for (const block of blocks) {
            expect(block).toContain("--ctl-arrow:");
            expect(block).toContain("--ctl-arrow-hi:");
        }
    });

    it("pins color-scheme per theme so the native popup follows the app, not the OS", () => {
        expect(css).toContain("color-scheme: dark;");
        expect(css.match(/color-scheme: light;/g)).toHaveLength(2);
    });

    it("drops the OS select widget and draws the chevron itself", () => {
        const rule = css.match(/\nselect \{[^}]+\}/);
        expect(rule).not.toBeNull();
        expect(rule[0]).toContain("appearance: none");
        expect(rule[0]).toContain("background-image: var(--ctl-arrow)");
        expect(rule[0]).toContain("min-height: var(--ctl-h)");
    });

    it("never sets the control background through the shorthand", () => {
        // The shorthand resets background-image, and it does so from a selector
        // list that outranks the plain `select` rule — .sel-sm loses its chevron.
        const base = css.match(/select,\s*\.field input[^{]+\{[^}]+\}/);
        expect(base).not.toBeNull();
        expect(base[0]).toContain("background-color: var(--bg)");
        expect(base[0]).not.toMatch(/[^-]background:/);
    });

    it("sizes every control that shares a line from the height tokens", () => {
        expect(css).toMatch(/--ctl-h:\s*\d+px/);
        expect(css).toMatch(/--ctl-h-sm:\s*\d+px/);
        for (const selector of [".btn ", ".btn-sm ", ".sel-sm ", ".inp-sm ", ".theme-toggle "]) {
            const rule = css.match(new RegExp(`\\n\\${selector}\\{[^}]+\\}`));
            expect(rule).not.toBeNull();
            expect(rule[0]).toMatch(/var\(--ctl-h(-sm)?\)/);
        }
    });

    it("bottom-aligns the filter bar so labelless cells land on the control line", () => {
        const rule = css.match(/\n\.filter-bar \{[^}]+\}/);
        expect(rule[0]).toContain("align-items: flex-end");
        expect(css).toContain(".filter-bar .field > label:only-child");
    });

    it("centres table cells and keeps rows with a control from stacking padding", () => {
        expect(css).toContain("table.idx td { vertical-align: middle; }");
        expect(css).toMatch(/table\.idx td:has\(select\)[\s\S]*?padding-top: 5px/);
        // The card override may only change the inset, else it outranks the rule above.
        expect(css).toContain(".dash-card table.idx th, .dash-card table.idx td { padding-left: 16px; padding-right: 16px; }");
    });

    it("has every filter bar in the client use the shared class", () => {
        const pages = ["pages/HistoryPage.tsx", "pages/RosterPage.tsx", "components/LootItemsTab.tsx", "components/LootReasonsTab.tsx"];
        for (const file of pages) {
            const src = fs.readFileSync(path.join(CLIENT, file), "utf8");
            expect(src).toContain("className=\"filter-bar\"");
            // the inline copy of .filter-bar's layout that these used to carry
            expect(src).not.toContain("padding: \"14px 16px\", borderBottom");
        }
    });
});
