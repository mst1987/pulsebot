const { matchRaidsheet, pickRaidsheet } = require("../../../src/utils/setup/raidsheets.js");

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

describe("utils/raidsheets pickRaidsheet (#542)", () => {
    const LIST = [...SHEETS, { id: "fv", name: "Forever", keywords: ["ony"] }];

    it("matches by keyword like before when no version names a sheet", () => {
        expect(pickRaidsheet(LIST, "GDKP Karazhan").id).toBe("t45");
        expect(pickRaidsheet(LIST, "Naxxramas")).toBeNull();
        expect(pickRaidsheet(null, "Karazhan")).toBeNull();
    });

    it("falls back to the version's own sheet when no keyword matches", () => {
        expect(pickRaidsheet(LIST, "Barrow Deeps", { ownId: "fv" }).id).toBe("fv");
        expect(pickRaidsheet(LIST, "Barrow Deeps", { ownId: "gone" })).toBeNull();
    });

    it("never hands an event another version's sheet by keyword", () => {
        // a Forever "Hyjal" must not land in the TBC Tier-6 sheet once TBC names it as its own
        expect(pickRaidsheet(LIST, "Hyjal Summit", { ownId: "fv", otherIds: ["t6", ""] }).id).toBe("fv");
        expect(pickRaidsheet(LIST, "Hyjal Summit", { ownId: "t6", otherIds: ["fv"] }).id).toBe("t6");
    });
});
