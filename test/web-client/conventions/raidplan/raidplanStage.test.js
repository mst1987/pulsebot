// The read view /p/<token> ("Karte als Bühne", PlanPublicPage.tsx), checked on its stylesheet styles/raidplan/stage.css: what a
// render in jsdom cannot see (layout and look). The behaviour runs in Vitest (PlanPublicPage.*.test.tsx).
const { read } = require("../../clientSource");

const css = read("styles/raidplan/stage.css");
/** the body of the first rule whose selector is exactly `selector` (outside a media query or inside, whichever comes first) */
const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no rule ${selector}`);
    return css.slice(at + selector.length + 2, css.indexOf("}", at));
};

describe("the raid plan's read view (stage.css)", () => {
    it("never shrinks the inline cards of a section without a map", () => {
        // a section without a map stacks "Deine Aufgaben" and "Alle Aufgaben" in .rp-sheet-flat, a flex column that scrolls. The card
        // has overflow: hidden (its body scrolls), so its minimum height is 0: on a phone the taller panel beside it squeezed it to
        // its 2px border, an empty orange bar (Oct 2026). flex: none keeps both at their own height; the column scrolls instead.
        expect(css).toMatch(/\.rp-sheet-flat \{[^}]*flex-direction: column;[^}]*overflow-y: auto;|\.rp-sheet-flat \{[^}]*overflow-y: auto;[^}]*flex-direction: column;/);
        expect(rule(".rp-sheet-mine.is-inline")).toMatch(/\bflex: none;/);
        expect(rule(".rp-sheet-panel.is-inline")).toMatch(/\bflex: none;/);
    });

    it("frames \"Deine Aufgaben\" quietly: one thin accent line, no accent frame, no tint (Pilot C)", () => {
        const mine = rule(".rp-sheet-mine");
        expect(mine).toContain("border: 1px solid var(--line);");
        expect(mine).toContain("border-top: 2px solid var(--accent);");
        expect(mine).not.toMatch(/gradient|accent-soft/);
        expect(mine).not.toContain("border: 2px solid var(--accent)");
    });

    it("sets its kickers in the sans in sentence case, at least the label size", () => {
        const kicker = rule(".rp-sheet .rp-kicker");
        expect(kicker).toContain("font-family: var(--font-sans);");
        expect(kicker).toContain("font-size: var(--fs-label);");
        expect(kicker).toContain("text-transform: none;");
        expect(css).not.toMatch(/var\(--font-mono\)/);
    });

    it("has no pills: chips, links and badges keep small corners", () => {
        for (const sel of [".rp-sheet-chip", ".rp-sheet-mine-links button", ".rp-sheet .rp-du, .rp-sheet .rp-lc-du"]) {
            expect(rule(sel)).toMatch(/border-radius: 3px;/);
        }
        expect(css).not.toMatch(/border-radius: (999px|1[4-9]px)/);
    });

    it("shows a task type as a plain heading, not a tinted caps label in a coloured frame", () => {
        const badge = rule(".rp-sheet .rp-tbadge");
        expect(badge).toContain("border: 0;");
        expect(badge).toContain("background: none;");
        expect(badge).toContain("color: var(--text);");
        expect(rule(".rp-sheet .rp-du, .rp-sheet .rp-lc-du")).toContain("text-transform: none;");
    });
});
