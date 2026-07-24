const { matchRaidsheet } = require("../../src/utils/raidsheets.js");

const SHEETS = [
    { id: "t45", name: "Tier 4/5", keywords: ["kara", "gruul", "maggi"] },
    { id: "t6", name: "Tier 6", keywords: ["swp", "sunwell", "hyjal"] },
    { id: "nokw", name: "Manuell", keywords: [] },
];

describe("utils/raidsheets matchRaidsheet", () => {
    it("matches by a keyword contained in the event title (case-insensitive)", () => {
        expect(matchRaidsheet(SHEETS, "GDKP Karazhan").id).toBe("t45");
        expect(matchRaidsheet(SHEETS, "gruul lair").id).toBe("t45");
        expect(matchRaidsheet(SHEETS, "Sunwell Plateau").id).toBe("t6");
    });

    it("returns null when no keyword matches", () => {
        expect(matchRaidsheet(SHEETS, "Naxxramas")).toBeNull();
    });

    it("returns the first matching sheet when several could match", () => {
        const sheets = [
            { id: "a", keywords: ["raid"] },
            { id: "b", keywords: ["raid"] },
        ];
        expect(matchRaidsheet(sheets, "weekly raid").id).toBe("a");
    });

    it("never auto-matches a sheet without keywords", () => {
        expect(matchRaidsheet([{ id: "x", keywords: [] }], "anything")).toBeNull();
    });

    it("handles empty/missing titles and lists safely", () => {
        expect(matchRaidsheet(SHEETS, "")).toBeNull();
        expect(matchRaidsheet(SHEETS, null)).toBeNull();
        expect(matchRaidsheet(null, "Karazhan")).toBeNull();
    });
});
