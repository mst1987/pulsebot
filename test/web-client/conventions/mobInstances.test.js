// One mob of several (docs/raidplan.md, "One mob of several"): the dialogs, the map menu and the sheet use it; the logic of
// lib/autoPlace.ts and lib/assign.ts is tested in src/web-client/src/lib/mobInstances.test.ts.
const fs = require("fs");
const path = require("path");
const { readWorkspace } = require("../clientSource");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

describe("the editor and the sheet use it", () => {
    it("the dialogs offer one tile per icon and hide the count / number for such a mob; the map menu offers 'Tankt -> Flame 2'", () => {
        expect(read("pages/raid-detail/raidplan/AssignPanel.tsx")).toContain("for (const tg of mobTargetsFor(board, mobTarget(m))) push(tg, t(\"raidBoard.assign.pickMobs\"))");
        expect(read("pages/raid-detail/raidplan/AssignModal.tsx")).toContain("!x.oid && mobIconsOf(tmp, x.ref).length < 2");
        const ws = readWorkspace();
        expect(ws).toContain("icons.map((ic) => it(`tankt:${m.id}@${ic.id}`, \"tank\"))");
        expect(ws).toContain("iconTarget(board, mobTarget(fallback), iconId)");
        expect(read("pages/PlanPublicPage.tsx")).toContain("icons: b.icons");
    });
});
