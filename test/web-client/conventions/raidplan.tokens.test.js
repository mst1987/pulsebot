// Tokens on the board: the facing UI checked on the source. The logic of
// tokens, sizes, icons, group markers and facing runs in Vitest
// (src/web-client/src/lib/raidplan.tokens.test.ts).
const fs = require("fs");
const path = require("path");
const { readWorkspace, read } = require("../clientSource");

// the compass names as the lib declares them
const COMPASS_NAMES = JSON.parse(read("lib/raidplan.ts").match(/^export const COMPASS_NAMES = (\[[^\]]*\]);/m)[1]);

describe("facing and board labels", () => {
    it("has the facing UI and its texts", () => {
        const insp = read("pages/raid-detail/raidplan/Inspector.tsx");
        expect(insp).toContain("rp-compass");
        const ws = readWorkspace();
        expect(ws).toContain("angleTo(");
        expect(ws).toContain("snapAngle(a, 15)");
        expect(read("components/raidplan/PlanBoard.tsx")).toContain("rp-h-rot");
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../src/web-client/src/i18n/locales", lang, "raidBoard.json"), "utf8"));
            for (const n of COMPASS_NAMES) expect(typeof d.compass[n]).toBe("string");
            expect(d.ctx.face).toContain("{dir}");
            expect(typeof d.icon.showLabel).toBe("string");
        }
    });
});
