// Auto placement from the tank rows: the wiring of the editor, the template and the sheet, checked on the source. The layout
// itself (lib/autoPlace.ts) runs in Vitest: src/web-client/src/lib/autoPlace.test.ts.
const fs = require("fs");
const path = require("path");
const { readWorkspace } = require("../clientSource");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

describe("wiring", () => {
    it("editor, template and sheet draw the same plan; one object is moved, reset and never deleted on its own", () => {
        const ws = readWorkspace();
        expect(ws).toContain("deriveAuto(filledRows, board, { template: !isEvent, roster })");
        expect(ws).toContain("raidBoard.auto.noDelete");
        expect(ws).toContain("autoUsers: auto.users");
        const sheet = read("pages/PlanPublicPage.tsx");
        expect(sheet).toContain("deriveAuto(boss.assignments");
        expect(sheet).toContain("boss.showMap !== false ? deriveAuto");
        const pb = read("components/raidplan/PlanBoard.tsx");
        expect(pb).toContain("data-obj={`auto:${k.key}`}");
        expect(pb).toContain("raidBoard.auto.missing");
        const rp = read("lib/raidplan.ts");
        expect(rp).toContain("if (kind === \"auto\") return board;");
    });
});
