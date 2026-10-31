// Guards for the note's mark beside a name (#981, src/web-client/src/components/vermerke/VermerkMark.tsx
// and the .vm-mark rules in src/web-client/src/styles/ui.css).
//
// On a phone the names get the whole width: the mark is hidden there by one
// rule in ui.css. The setup's shadowban line (ShadowbanPoolLine) and the slot
// drawer (SlotTip) draw LevelMark directly, without .vm-mark, so they stay on
// a phone. Module stylesheets never style .vm-mark (cssNamespaces) - they pass
// their own class through VermerkMark's className.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "..", "src", "web-client", "src");
const read = (...p) => fs.readFileSync(path.join(CLIENT, ...p), "utf8").replace(/\r\n/g, "\n");
const ui = read("styles", "ui.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("note mark beside a name", () => {
    it("is hidden on a phone, at the phone breakpoint of ui.css", () => {
        const m = ui.match(/@media \(max-width: (\d+)px\) \{\s*\.vm-mark \{ display: none; \}\s*\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toBe("640");
        // the desktop rule itself still shows it
        expect(ui).toMatch(/\n\.vm-mark \{ display: inline-flex;/);
    });

    it("leaves the shadowban line and the slot drawer on a phone (LevelMark, not VermerkMark)", () => {
        for (const file of ["ShadowbanPoolLine.tsx", "SlotTip.tsx"]) {
            const src = read("pages", "raid-detail", "setup", file);
            expect(src).toContain("LevelMark");
            expect(src).not.toContain("VermerkMark");
            expect(src).not.toContain("vm-mark");
        }
    });

    it("lets a module space its mark with its own class", () => {
        const mark = read("components", "vermerke", "VermerkMark.tsx");
        expect(mark).toContain("className?: string;");
        expect(read("styles", "kader.css")).toContain(".kp-cell-name .kp-vmark");
        expect(read("styles", "setup-editor.css")).toContain(".se-nameline .se-vmark");
    });
});
