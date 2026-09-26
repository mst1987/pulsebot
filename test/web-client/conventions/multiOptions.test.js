// Two more things of feature/raidplan-13 (docs/raidplan.md), checked on the source: the inspector of a multi-selection shows every
// option ALL selected objects have (MultiInspector), and the editor opens a board with the cutout the sheet opens it with
// (BoardWorkspace applies board.view like PlanPublicPage). The libs (lib/multiSelect.ts, lib/boardView.ts) run in Vitest:
// src/web-client/src/lib/multiOptions.test.ts.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

describe("the options a multi-selection shares", () => {
    it("the inspector shows them, one mark per option ('gemischt' in the label), no native select", () => {
        const src = read("pages/raid-detail/raidplan/MultiInspector.tsx");
        expect(src).toContain("{has.facing && (");
        expect(src).toContain("setFacingSelection(b, sel, { rotation: a })");
        expect(src).toContain("patchArrowSelection(b, sel, { color: e.target.value })");
        expect(src).not.toContain("<select");
    });
});

describe("the editor opens a board as the sheet does", () => {
    it("BoardWorkspace applies the saved cutout on open and when it changes; the sheet does the same", () => {
        const ws = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
        expect(ws).toContain("useEffect(() => { bv.set(viewFromSaved(board.view)); }, [boss.key, savedKey]);");
        expect(ws).toContain("sheetView={viewFromSaved(board.view)} onSheetView={() => bv.set(viewFromSaved(board.view))}");
        expect(read("pages/PlanPublicPage.tsx")).toContain("bv.set(viewFromSaved(b ? b.view : null))");
        expect(read("pages/raid-detail/raidplan/ViewControls.tsx")).toContain("{offSheet && <button");
    });
});
