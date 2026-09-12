const { bossIconUrl, bossName, baseEncounterId } = require("../../src/config/bosses");

// The Anniversary realms log the TBC bosses under offset encounter ids — 50xxx for
// Karazhan, Gruul/Magtheridon and BT/Hyjal, 100xxx for SSC/TK — while the icons and
// names are keyed by the original ids WCL Classic used. Both must resolve.
describe("config/bosses — encounter ids", () => {
    it("knows the original TBC ids", () => {
        expect(bossIconUrl(609)).toBe("/bosses/609.jpg");
        expect(bossName(609)).toBe("Illidan Stormrage");
        expect(baseEncounterId(623)).toBe(623);
    });

    it("folds the Anniversary offsets back onto the original ids", () => {
        expect(bossIconUrl(50609)).toBe("/bosses/609.jpg");     // BT / Hyjal
        expect(bossName(50618)).toBe("Rage Winterchill");
        expect(bossIconUrl(50650)).toBe("/bosses/650.jpg");     // Gruul
        expect(bossIconUrl(50661)).toBe("/bosses/661.jpg");     // Karazhan
        expect(bossIconUrl(100623)).toBe("/bosses/623.jpg");    // SSC / TK
        expect(bossName(100733)).toBe("Kael'thas Sunstrider");
        expect(baseEncounterId("50609")).toBe(609);
    });

    it("answers nothing for an id it cannot place", () => {
        expect(bossIconUrl(999999)).toBe("");
        expect(bossName(0)).toBe("");
        expect(baseEncounterId(undefined)).toBe(-1);
        expect(baseEncounterId(50000)).toBe(-1);
    });
});
