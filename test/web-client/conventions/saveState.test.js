// Unsaved changes stand out in the plan and template editor: the wiring of the save button, the strip, the chips, Ctrl+S and the
// warning on leaving (pages/raid-detail/raidplan/SaveState.tsx), checked on the source. Which sections differ from the saved plan
// (lib/raidplan/model.ts dirtyKeys) runs in Vitest: src/web-client/src/lib/raidplan/saveState.test.ts.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

describe("the unsaved state is loud and accessible", () => {
    const save = read("pages/raid-detail/raidplan/SaveState.tsx");
    const css = read("styles/raidplan.css");
    it("Ctrl+S saves (the browser's own is suppressed), the tab title gets a dot, leaving asks", () => {
        expect(save).toMatch(/e\.key\.toLowerCase\(\) === "s"/);
        expect(save).toContain("e.preventDefault();");
        expect(save).toContain("beforeunload");
        expect(save).toContain("document.title = `● ${title}`");
    });
    it("text and icon, not colour alone; aria-live; no pulse with reduced motion", () => {
        expect(save).toContain("role=\"status\" aria-live=\"polite\"");
        expect(save).toContain("raidBoard.save.unsaved");
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.rp-sticky\.is-dirty, \.rp-savebtn\.is-dirty/);
        expect(css).toContain(".rp-sticky.is-conflict");
    });
    it("both editors use it, and the boss chips mark unsaved sections", () => {
        for (const f of ["pages/raid-detail/RaidplanTab.tsx", "pages/RaidplanTemplatesPage.tsx"]) {
            const src = read(f);
            expect(src).toContain("useUnsavedGuard(");
            expect(src).toContain("<SaveButton");
            expect(src).toContain("<UnsavedBar");
            expect(src).toContain("dirtyKeys={unsavedKeys}");
        }
        expect(read("pages/raid-detail/raidplan/BossNav.tsx")).toContain("is-unsaved");
    });
});
