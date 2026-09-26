// The switch that plans a boss / trash section without its map (components wiring in BoardWorkspace / PlanPublicPage), checked on
// the source. Which section a plan opens on and the section remembered per plan (lib/raidplan.ts) run in Vitest:
// src/web-client/src/lib/raidplanSection.test.ts.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

describe("a section planned without its map", () => {
    it("the editor drops the map tools and says the objects stay; the sheet drops the image", () => {
        const ws = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
        expect(ws).toContain("board.showMap === false");
        expect(ws).toContain("raidBoard.map.offNote");
        expect(ws).toContain("raidBoard.map.hiddenKept");
        const sheet = read("pages/PlanPublicPage.tsx");
        expect(sheet).toContain("boss.showMap !== false && (");
        expect(sheet).toContain("\" no-map\"");
    });
});
