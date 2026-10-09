// Setup-Editor (#263): the rules a render cannot see — its own stylesheet and
// class namespace, no drag-and-drop library, and the CSS decisions that were
// checked in a real browser (one fixed top row, the stacked panel, row heights,
// the lock mark, nothing clickable on a line). What the editor does is rendered in Vitest:
// src/web-client/src/pages/raid-detail/setup/SetupEditor.test.tsx and
// SetupEditor.panel.test.tsx; the moves behind it in lib/signups/setupEditor.test.ts.
const { read } = require("../clientSource");

describe("setup editor conventions", () => {
    // the editor with its parts (pages/raid-detail/setup/, #438)
    const editor = read("pages", "raid-detail", "setup");
    const css = read("styles", "setup-editor.css");

    it("uses its own stylesheet and namespace, no gold", () => {
        expect(editor).toContain("import \"../../../styles/setup-editor.css\";");
        const classes = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || [];
        for (const c of classes) expect(c).toMatch(/^\.(se-|wi$|btn$|is-on$)/);
        expect(css).not.toMatch(/gold|#d4af37|#ffd700/i);
    });

    it("moves raiders without a drag-and-drop library", () => {
        expect(editor).not.toMatch(/from "(react-dnd|@dnd-kit|react-beautiful-dnd)/);
    });

    it("draws the bench under a divider, across the full width", () => {
        expect(css).toMatch(/\.se-bench::before \{[^}]*border-top/);
    });

    it("keeps the bar ONE line over groups across the full width — no box stands open above them", () => {
        // five groups side by side: the cards are ~190 px wide, the compact ones narrower
        expect(css).toMatch(/\.se-groups \{[^}]*minmax\(188px/);
        expect(css).toMatch(/\.se-compact \.se-groups \{[^}]*minmax\(158px/);
        // the old top row (ping box, tiles, docked panel) and the line under the bar are gone
        expect(css).not.toMatch(/\.se-topline|\.se-publish|\.se-tip-empty|\.se-bar-hint/);
        // the counts stay on the bar's line and cut, on a phone they wrap; quiet buttons keep a visible outline
        expect(css).toMatch(/\.se-counts \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
        expect(css).toMatch(/\.se-bar-act \.btn\[class\*="ghost"\] \{[^}]*border: 1px solid color-mix/);
        // the bench and "Angemeldet" are rows, the summary one line
        expect(css).toMatch(/\.se-row \{ display: flex;/);
        expect(css).toMatch(/\.se-sumline \{ display: flex;/);
    });

    it("opens the raider panel as a drawer that scrolls itself, one column, compact enough for the worst case", () => {
        expect(css).toMatch(/\.se-drawer \{\s*position: fixed;[^}]*width: min\(440px, calc\(100vw - 32px\)\)/);
        expect(css).toMatch(/\.se-drawer > \.se-tip \{[^}]*overflow-y: auto/);
        expect(css).toMatch(/\.se-tip \{ font-family: inherit; font-size: 13\.5px;[^}]*grid-template-columns: minmax\(0, 1fr\)/);
        expect(css).toMatch(/\.se-tip-top \{ grid-column: 1 \/ -1;/);
        expect(css).toMatch(/\.se-tip-buff \.wi \{ width: 22px/);
        expect(css).toMatch(/\.se-tip-att b \{[^}]*font-size: 28px/);
        // the name is never wrapped and never cut off; the Auto badge is not in capitals
        expect(css).toMatch(/\.se-tip-name \{[^}]*white-space: nowrap/);
        expect(css).not.toMatch(/\.se-tip-name \{[^}]*text-overflow/);
        expect(css).not.toMatch(/\.se-tip-auto \{[^}]*text-transform: uppercase/);
        expect(css).toMatch(/\.se-tip-spec\.is-on \{[^}]*border-color: var\(--accent\)/);
    });

    it("turns the drawer into a sheet from the bottom on a phone, buffs two by two", () => {
        expect(css).toMatch(/@media \(max-width: 600px\) \{\s*\.se-drawer \{ top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 85vh; \}/);
        expect(css).toMatch(/\.se-tip-buffs \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    });

    it("gives a raider and a free place one row height, so cards are equally tall", () => {
        expect(css).toMatch(/\.se-editor \{[^}]*--se-row: 46px/);
        expect(css).toMatch(/\.se-slot \{[^}]*height: var\(--se-row\)/);
        expect(css).toMatch(/\.se-ph \{[^}]*height: var\(--se-row\)/);
        expect(css).toMatch(/\.se-compact \{ --se-row: 32px; \}/);
    });

    it("draws the lock as a small corner mark that takes no width from the raider's name", () => {
        expect(css).toMatch(/\.se-slot \{ position: relative;/);
        expect(css).toMatch(/\.se-lock-mark \{ position: absolute;[^}]*width: 12px;[^}]*pointer-events: none/);
        expect(css).not.toMatch(/\.se-lock-mark \{[^}]*flex: 0 0 auto/);
    });

    it("keeps nothing clickable on a raider's line — the actions live in the panel", () => {
        // a button there once sat under the name and the confirm mark and could not be clicked
        expect(css).not.toMatch(/\.se-(lock|editbtn|confirmbtn) \{/);
        expect(css).toMatch(/\.se-tip-act \{/);
        // the confirm mark is a small round badge on the spec icon's bottom right corner — the line's right stays free
        expect(css).toMatch(/\.se-slot-tile \{ position: relative;/);
        expect(css).toMatch(/\.se-confirm-mark \{ position: absolute; right: -\d+px; bottom: -\d+px;[^}]*width: 14px; height: 14px; border-radius: 50%/);
        // the picked raider wins over the green/red tint
        expect(css).toMatch(/\.se-slot\.se-picked\.se-confirmed[^{]*\{[^}]*border-color: var\(--accent\)/);
    });
});
