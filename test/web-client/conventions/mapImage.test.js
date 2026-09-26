// The room map's client-side shrinking (lib/mapImage.ts): when to shrink, to what size,
// which encoder settings are tried in which order, and the text shown.
// The logic runs in src/web-client/src/lib/mapImage.test.ts (Vitest).
const fs = require("fs");
const path = require("path");

describe("texts and wiring", () => {
    const root = path.join(__dirname, "../../../src/web-client/src");
    it("has the messages in both languages", () => {
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(root, "i18n/locales", lang, "raidBoard.json"), "utf8"));
            expect(d.board.mapCompressed).toContain("{from}");
            expect(d.board.mapCompressed).toContain("{to}");
            for (const k of ["mapCannotShrink", "mapNotImage", "mapUnreadable"]) expect(typeof d.board[k]).toBe("string");
        }
    });
    it("the map panel shrinks before it uploads", () => {
        const panel = fs.readFileSync(path.join(root, "pages/raid-detail/raidplan/MapPanel.tsx"), "utf8");
        expect(panel).toContain("prepareMapFile(file)");
        expect(panel.indexOf("prepareMapFile(file)")).toBeLessThan(panel.indexOf("uploadRaidplanMap("));
    });
});
