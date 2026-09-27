// Highlighting a group (#512): which elements carry .rp-gdim is a render test (src/web-client/src/pages/PlanPublicPage.groupFocus.test.tsx);
// that the class really dims is CSS jsdom cannot compute, so it is held here. The wrapper of a group marker is `display: contents`
// (it draws no box, so an opacity of its own never shows - the chips did nothing for that reason); .rp-gdim only sets a factor that the
// board objects multiply into their own opacity, which carries !important since #441.

const { read } = require("../clientSource"); // inlines the @imports of a stylesheet (#441)

describe("dimming the other groups", () => {
    const css = read("styles/raidplan/index.css");

    it("never puts an opacity on the group marker's wrapper (display: contents)", () => {
        expect(css).toMatch(/\.rp-groupwrap \{ display: contents; \}/);
        expect(css).not.toMatch(/\.rp-groupwrap(\.[\w-]+)* \{[^}]*\bopacity:/);
    });

    it("sets a factor from a design variable that the board objects multiply into --rp-o", () => {
        expect(css).toContain(".rp-gdim { --rp-gf: var(--rp-group-dim); }");
        expect(css).toContain(".rp-board :is(.rp-token, .rp-text) { left: var(--rp-x) !important; top: var(--rp-y) !important; opacity: calc(var(--rp-o, 1) * var(--rp-gf, 1)) !important; }");
        expect(css).toMatch(/\.rp-board \.rp-groupring \{[^}]*opacity: calc\(var\(--rp-o, 1\) \* var\(--rp-gf, 1\)\) !important; \}/);
        expect(css).toContain(".rp-rtable tr.rp-gdim { opacity: var(--rp-group-dim); }");
        expect(read("styles/tokens.css")).toMatch(/--rp-group-dim: \.22;/);
    });

    it("PlanBoard hands the class to group markers, role slots, free tokens and auto tokens of raiders", () => {
        const pb = read("components/raidplan/PlanBoard.tsx");
        expect(pb).toContain("className={`rp-groupwrap${gf(s.n)}`}");
        expect(pb).toContain("${player ? gf(player.group) : \" is-open\"}");
        expect(pb.split("${gf(p.group)}").length - 1).toBe(2);
    });
});
