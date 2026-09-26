// The turned role group and the editor on a phone (PlanBoard, BoardWorkspace, the stylesheet); the role group logic of
// lib/raidplan/assign.ts and lib/raidplan/mineView.ts is tested in src/web-client/src/lib/roleMine.test.ts.
const fs = require("fs");
const path = require("path");
const { readWorkspace } = require("../clientSource");

const dir = path.join(__dirname, "../../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

describe("the turned role group and the editor on a phone", () => {
    it("a role group turns about its middle (grip, Q / E, degrees in the inspector), the same in the sheet", () => {
        const pb = read("components/raidplan/PlanBoard.tsx");
        expect(pb).toContain("z.type === \"role\" && z.rotation ? { transform: `rotate(${z.rotation}deg)` }");
        expect(pb).toContain("rp-h-zrot");
        const ws = readWorkspace();
        expect(ws).toContain("d.handle === \"rot\" && d.center && d.kind === \"zone\"");
        expect(ws).toContain("closest(\".rp-token, .rp-text, .rp-zone\")");
    });

    it("up to 1000 px the dock goes under the map: the later two-column rule is overridden again (the map shrank to ~50 px on a phone)", () => {
        const css = read("styles/raidplan.css").replace(/\r\n/g, "\n");
        const two = css.indexOf(".rp-stage2 { grid-template-columns: minmax(0, 1fr) 300px; }");
        const fix = css.indexOf("@media (max-width: 1000px) {\n    .rp-stage2, .rp-stage2.no-dock { grid-template-columns: minmax(0, 1fr); }\n}");
        expect(two).toBeGreaterThan(0);
        expect(fix).toBeGreaterThan(two);
    });
});
