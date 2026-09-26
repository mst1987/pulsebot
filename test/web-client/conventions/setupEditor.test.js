// Setup-Editor (#263): the rules a render cannot see — its own stylesheet and
// class namespace, no drag-and-drop library, and the CSS decisions that were
// checked in a real browser (one fixed top row, the stacked panel, row heights,
// the lock overlay). What the editor does is rendered in Vitest:
// src/web-client/src/pages/raid-detail/SetupEditor.test.tsx and
// SetupEditor.panel.test.tsx; the moves behind it in lib/setupEditor.test.ts.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("setup editor conventions", () => {
    const editor = read("pages", "raid-detail", "SetupEditor.tsx");
    const css = read("styles", "setup-editor.css");

    it("uses its own stylesheet and namespace, no gold", () => {
        expect(editor).toContain("import \"../../styles/setup-editor.css\";");
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

    it("keeps the top row one fixed height: whatever does not fit is cut inside its own box", () => {
        // five groups side by side: the cards are ~190 px wide, the compact ones narrower
        expect(css).toMatch(/\.se-groups \{[^}]*minmax\(188px/);
        expect(css).toMatch(/\.se-compact \.se-groups \{[^}]*minmax\(158px/);
        expect(css).toMatch(/\.se-topline \{[^}]*grid-template-rows: 352px/);
        // stacked below 1360 px of viewport (the sidebar takes ~250 px, the panel needs ~600 px of its own)
        expect(css).toMatch(/@media \(max-width: 1360px\) \{\s*\.se-topline \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows: none;/);
        expect(css).toMatch(/\.se-topline > \* \{[^}]*overflow: hidden/);
        // every figure and setting a bordered tile of its own, label over value; quiet buttons keep a visible outline
        expect(css).toMatch(/\.se-topline \.se-stats \{ display: contents; \}/);
        expect(css).toMatch(/\.se-topline \.se-side-row \{[^}]*border: 1px solid var\(--line\)/);
        expect(css).toMatch(/\.se-topline \.se-side-row \{[^}]*grid-template-columns: minmax\(0, 1fr\); justify-items: start/);
        expect(css).toMatch(/\.se-bar-act \.btn\[class\*="ghost"\] \{[^}]*border: 1px solid color-mix/);
        expect(css).toMatch(/\.se-bar-hint \{ display: none; \}/);
    });

    it("lays the raider panel out as a header over three columns, compact enough for the worst case", () => {
        expect(css).toMatch(/\.se-tip \{[^}]*grid-template-columns: minmax\(0, 1\.3fr\) minmax\(0, 1\.2fr\) minmax\(0, \.9fr\); grid-template-rows: auto minmax\(0, 1fr\)/);
        expect(css).toMatch(/\.se-tip-top \{ grid-column: 1 \/ -1;/);
        expect(css).toMatch(/\.se-tip \{ font-family: inherit; font-size: 13\.5px;/);
        expect(css).toMatch(/\.se-tip-buff \.wi \{ width: 22px/);
        expect(css).toMatch(/\.se-tip-att b \{[^}]*font-size: 28px/);
        expect(css).not.toMatch(/\.se-tip \{[^}]*overflow-y: auto/);
        expect(css).not.toMatch(/\.se-tip \{[^}]*max-height/);
        // the name is never wrapped and never cut off; the Auto badge is not in capitals
        expect(css).toMatch(/\.se-tip-name \{[^}]*white-space: nowrap/);
        expect(css).not.toMatch(/\.se-tip-name \{[^}]*text-overflow/);
        expect(css).not.toMatch(/\.se-tip-auto \{[^}]*text-transform: uppercase/);
        expect(css).toMatch(/\.se-tip-spec\.is-on \{[^}]*border-color: var\(--accent\)/);
    });

    it("keeps the panel compact when the top area is stacked, buffs two by two on a phone", () => {
        const stacked = css.slice(css.indexOf("@media (max-width: 1360px)"));
        expect(stacked).toMatch(/\.se-tip \{ grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 1fr\); min-height: 430px; \}/);
        expect(stacked).toMatch(/\.se-tip-col:last-child \{ grid-column: 1 \/ -1; \}/);
        expect(stacked).toMatch(/\.se-tip-col:last-child \.se-tip-body \{ flex-direction: row; flex-wrap: wrap;/);
        // a phone: one column with a reserved height, so hovering never moves the groups under the pointer
        expect(css).toMatch(/@media \(max-width: 600px\) \{\s*\.se-tip \{ grid-template-columns: minmax\(0, 1fr\); padding: 14px 14px; min-height: 500px; \}/);
        expect(css).toMatch(/\.se-tip-buffs \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    });

    it("gives a raider and a free place one row height, so cards are equally tall", () => {
        expect(css).toMatch(/\.se-editor \{[^}]*--se-row: 46px/);
        expect(css).toMatch(/\.se-slot \{[^}]*height: var\(--se-row\)/);
        expect(css).toMatch(/\.se-ph \{[^}]*height: var\(--se-row\)/);
        expect(css).toMatch(/\.se-compact \{ --se-row: 32px; \}/);
    });

    it("draws the lock as an overlay that takes no width from the raider's name", () => {
        expect(css).toMatch(/\.se-slot \{ position: relative;/);
        expect(css).toMatch(/\.se-lock \{ position: absolute;/);
        expect(css).toMatch(/\.se-lock\.is-on \{[^}]*opacity: 1;[^}]*width: 14px/);
        expect(css).not.toMatch(/\.se-lock \{[^}]*flex: 0 0 auto/);
    });
});
