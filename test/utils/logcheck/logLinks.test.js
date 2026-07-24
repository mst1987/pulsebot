const { extractWclLinks } = require("../../../src/utils/logcheck/logLinks");

describe("utils/logcheck/logLinks", () => {
    it("returns an empty array for empty/blank input", () => {
        expect(extractWclLinks("")).toEqual([]);
        expect(extractWclLinks(null)).toEqual([]);
        expect(extractWclLinks(undefined)).toEqual([]);
        expect(extractWclLinks("no links here")).toEqual([]);
    });

    it("extracts a report id from a classic link", () => {
        const out = extractWclLinks("check https://classic.warcraftlogs.com/reports/AbCd1234efGh5678 please");
        expect(out).toHaveLength(1);
        expect(out[0].reportId).toBe("AbCd1234efGh5678");
        expect(out[0].link).toBe("https://classic.warcraftlogs.com/reports/AbCd1234efGh5678");
    });

    it("handles fresh/tbc subdomains and strips fragments/queries", () => {
        expect(extractWclLinks("https://fresh.warcraftlogs.com/reports/XyZ9#fight=2")[0].reportId).toBe("XyZ9");
        expect(extractWclLinks("https://tbc.warcraftlogs.com/reports/QwErTy?type=casts")[0].reportId).toBe("QwErTy");
    });

    it("normalises the .cn host to .com", () => {
        const out = extractWclLinks("https://www.warcraftlogs.cn/reports/CnReport01");
        expect(out).toHaveLength(1);
        expect(out[0].reportId).toBe("CnReport01");
        expect(out[0].link).toBe("https://www.warcraftlogs.com/reports/CnReport01");
    });

    it("deduplicates repeated report ids, keeping order", () => {
        const text = "https://classic.warcraftlogs.com/reports/AAA111 and again "
            + "https://fresh.warcraftlogs.com/reports/BBB222 and dup https://classic.warcraftlogs.com/reports/AAA111";
        const out = extractWclLinks(text);
        expect(out.map((o) => o.reportId)).toEqual(["AAA111", "BBB222"]);
    });

    it("finds multiple distinct links across lines", () => {
        const out = extractWclLinks("line1 https://classic.warcraftlogs.com/reports/One1\nline2 https://classic.warcraftlogs.com/reports/Two2");
        expect(out.map((o) => o.reportId)).toEqual(["One1", "Two2"]);
    });

    it("ignores non-report warcraftlogs urls (e.g. character pages)", () => {
        expect(extractWclLinks("https://fresh.warcraftlogs.com/character/eu/realm/name")).toEqual([]);
    });
});
