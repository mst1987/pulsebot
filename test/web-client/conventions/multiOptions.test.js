// Two more things of feature/raidplan-13 (docs/raidplan.md), checked on the source: the inspector of a multi-selection shows every
// option ALL selected objects have (MultiInspector), and the editor opens a board with the cutout the sheet opens it with
// (BoardWorkspace applies board.view like PlanPublicPage). The libs (lib/raidplan/multiSelect.ts, lib/raidplan/boardView.ts) run in Vitest:
// src/web-client/src/lib/multiOptions.test.ts.
const fs = require("fs");
const path = require("path");
const { readWorkspace } = require("../clientSource");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

describe("the options a multi-selection shares", () => {
    it("the inspector shows them, one mark per option ('gemischt' in the label), no native select", () => {
        const src = read("components/raidplan/editor/MultiInspector.tsx");
        expect(src).toContain("{has.facing && (");
        expect(src).toContain("setFacingSelection(b, sel, { rotation: a })");
        expect(src).toContain("patchArrowSelection(b, sel, { color: e.target.value })");
        expect(src).not.toContain("<select");
    });
});

describe("the editor opens a board as the sheet does", () => {
    it("BoardWorkspace applies the saved cutout on open and when it changes; the sheet does the same", () => {
        const ws = readWorkspace();
        expect(ws).toContain("useEffect(() => { bv.set(viewFromSaved(board.view)); }, [boss.key, savedKey]);");
        expect(ws).toContain("sheetView={viewFromSaved(board.view)} onSheetView={() => bv.set(viewFromSaved(board.view))}");
        // the sheet: on open and when the saved view changes - not on every live update (#555)
        expect(read("pages/raidplan/PlanPublicPage.tsx")).toContain("useEffect(() => { bv.set(viewFromSaved(savedView)); }, [selected, savedViewKey]);");
        expect(read("components/raidplan/editor/ViewControls.tsx")).toContain("{offSheet && <button");
    });
});
