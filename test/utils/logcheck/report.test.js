// Focused on buildReport()'s in-flight de-dup guard (two submits of the same
// link racing must not build/save the report twice) — the rest of the pipeline
// (analyzers) is mocked out since it's covered by their own unit tests.
const mockGetFights = jest.fn();
const mockGetCasts = jest.fn();
const mockParseReportId = jest.fn((link) => String(link || "").trim() || null);

jest.mock("../../../src/classes/warcraftlogs.js", () => {
    function WarcraftLogsMock() {
        this.getFights = mockGetFights;
        this.getCasts = mockGetCasts;
    }
    WarcraftLogsMock.parseReportId = (...args) => mockParseReportId(...args);
    return WarcraftLogsMock;
});
jest.mock("../../../src/utils/logcheck/gearIssues.js", () => ({
    buildGearIssues: jest.fn(() => []),
    buildArmory: jest.fn(() => ({})),
}));
jest.mock("../../../src/utils/logcheck/consumables.js", () => ({ analyzeConsumables: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/shadowResi.js", () => ({ analyzeShadowResi: jest.fn(() => null) }));
jest.mock("../../../src/utils/logcheck/drums.js", () => ({ analyzeDrums: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/potions.js", () => ({
    analyzePotions: jest.fn(async () => null),
    potionsByName: jest.fn(() => ({})),
}));
jest.mock("../../../src/utils/logcheck/sunder.js", () => ({ analyzeSunder: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/bossUptimes.js", () => ({ analyzeBossUptimes: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/rpb/index.js", () => ({
    analyzeRpb: jest.fn(async () => ({ roles: {}, byRole: {} })),
    rpbSummaryLines: jest.fn(() => ["🎭 Rollen: Tank 2"]),
}));
jest.mock("../../../src/utils/logcheck/common.js", () => ({ selectPlayers: jest.fn(() => []) }));
const mockSaveReport = jest.fn();
const mockGetReport = jest.fn();
jest.mock("../../../src/web/reportStore.js", () => ({
    saveReport: (...args) => mockSaveReport(...args),
    getReport: (...args) => mockGetReport(...args),
}));
jest.mock("../../../src/config/variables.js", () => ({ publicBaseUrl: "http://localhost:3005" }));

const { analyzeConsumables } = require("../../../src/utils/logcheck/consumables.js");
const { analyzeRpb } = require("../../../src/utils/logcheck/rpb/index.js");
const { buildReport, reportSummaryLines, normalizeSections, ReportError } = require("../../../src/utils/logcheck/report.js");

beforeEach(() => {
    jest.clearAllMocks();
    mockParseReportId.mockImplementation((link) => String(link || "").trim() || null);
    mockGetFights.mockResolvedValue({ title: "SSC + TK", zoneName: "Serpentshrine Cavern", start: 0, end: 100 });
    mockGetCasts.mockResolvedValue({ entries: [] });
    mockGetReport.mockReturnValue(null);
    let n = 0;
    mockSaveReport.mockImplementation(() => `id${++n}`);
});

describe("logcheck/report — buildReport dedup", () => {
    it("joins an already-running build for the same report id instead of starting a second one", async () => {
        const [a, b] = await Promise.all([buildReport("RPT1"), buildReport("RPT1")]);
        expect(mockGetFights).toHaveBeenCalledTimes(1);
        expect(mockGetCasts).toHaveBeenCalledTimes(1);
        expect(mockSaveReport).toHaveBeenCalledTimes(1);
        expect(a.id).toBe(b.id);
        expect(a.url).toBe(b.url);
    });

    it("builds fresh again once the previous build for that report id has finished", async () => {
        await buildReport("RPT1");
        await buildReport("RPT1");
        expect(mockGetFights).toHaveBeenCalledTimes(2);
        expect(mockSaveReport).toHaveBeenCalledTimes(2);
    });

    it("does not de-dup two different report ids", async () => {
        await Promise.all([buildReport("RPT1"), buildReport("RPT2")]);
        expect(mockGetFights).toHaveBeenCalledTimes(2);
        expect(mockSaveReport).toHaveBeenCalledTimes(2);
    });

    it("clears the in-flight guard even when the build fails, so a retry is not stuck", async () => {
        mockGetFights.mockRejectedValueOnce(new Error("boom"));
        await expect(buildReport("RPT1")).rejects.toThrow(ReportError);
        mockGetFights.mockResolvedValueOnce({ title: "T", zoneName: "Z", start: 0, end: 1 });
        await expect(buildReport("RPT1")).resolves.toMatchObject({ id: expect.any(String) });
        expect(mockGetFights).toHaveBeenCalledTimes(2);
    });

    it("rejects a link without a parseable report id before touching the API", async () => {
        mockParseReportId.mockReturnValueOnce(null);
        await expect(buildReport("not-a-link")).rejects.toThrow(ReportError);
        expect(mockGetFights).not.toHaveBeenCalled();
    });

    it("keys the guard by section, so CLA and RPB of one log run side by side", async () => {
        await Promise.all([
            buildReport("RPT1", { sections: ["cla"] }),
            buildReport("RPT1", { sections: ["rpb"] }),
        ]);
        expect(mockSaveReport).toHaveBeenCalledTimes(2);
        expect(analyzeConsumables).toHaveBeenCalledTimes(1);
        expect(analyzeRpb).toHaveBeenCalledTimes(1);
    });
});

describe("logcheck/report — sections", () => {
    it("normalizeSections defaults to both halves and drops unknown values", () => {
        expect(normalizeSections()).toEqual(["cla", "rpb"]);
        expect(normalizeSections("rpb")).toEqual(["rpb"]);
        expect(normalizeSections(["rpb", "cla"])).toEqual(["cla", "rpb"]); // canonical order
        expect(normalizeSections(["nonsense"])).toEqual(["cla", "rpb"]);   // nothing valid → both
    });

    it("runs only the CLA analyzers for the cla section", async () => {
        await buildReport("RPT1", { sections: ["cla"] });
        expect(analyzeConsumables).toHaveBeenCalled();
        expect(analyzeRpb).not.toHaveBeenCalled();
    });

    it("runs only the RPB analyzer for the rpb section", async () => {
        await buildReport("RPT1", { sections: ["rpb"] });
        expect(analyzeRpb).toHaveBeenCalled();
        expect(analyzeConsumables).not.toHaveBeenCalled();
    });

    it("records which sections a report carries", async () => {
        const { report } = await buildReport("RPT1", { sections: ["rpb"] });
        expect(report.sections).toEqual(["rpb"]);
    });
});

describe("logcheck/report — merging the two halves", () => {
    it("writes into the existing report id instead of creating a second page", async () => {
        mockGetReport.mockReturnValue({ id: "old1", sections: ["cla"], consumables: { players: [1] } });
        const res = await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "old1" });
        expect(mockSaveReport).toHaveBeenCalledWith(expect.any(Object), "old1");
        expect(res.url).toContain("/r/");
    });

    it("keeps the CLA result when the RPB half is added", async () => {
        const claData = { players: [{ name: "Alice" }] };
        mockGetReport.mockReturnValue({ id: "old1", sections: ["cla"], consumables: claData, drums: { players: [] } });
        const { report } = await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "old1" });
        expect(report.consumables).toBe(claData);   // untouched by the RPB run
        expect(report.rpb).not.toBeNull();
        expect(report.sections).toEqual(expect.arrayContaining(["cla", "rpb"]));
    });

    it("keeps the RPB result when the CLA half is added", async () => {
        const rpbData = { roles: { Alice: "Caster" } };
        mockGetReport.mockReturnValue({ id: "old1", sections: ["rpb"], rpb: rpbData });
        const { report } = await buildReport("RPT1", { sections: ["cla"], mergeIntoId: "old1" });
        expect(report.rpb).toBe(rpbData);            // untouched by the CLA run
        expect(report.sections).toEqual(expect.arrayContaining(["cla", "rpb"]));
    });

    it("creates a new page when the id to merge into no longer exists", async () => {
        mockGetReport.mockReturnValue(null);
        await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "gone" });
        expect(mockSaveReport).toHaveBeenCalledWith(expect.any(Object), undefined);
    });

    it("merges the icon maps of both halves", async () => {
        mockGetReport.mockReturnValue({ id: "old1", sections: ["cla"], icons: { flask: "a.jpg" } });
        const { report } = await buildReport("RPT1", { sections: ["cla"], mergeIntoId: "old1" });
        expect(report.icons).toEqual(expect.objectContaining({ flask: "a.jpg" }));
    });
});

describe("logcheck/report — reportSummaryLines", () => {
    const report = {
        players: [{ issues: [1, 2] }],
        roster: [{}, {}],
        consumables: { players: [{}] },
        rpb: { byRole: {} },
    };

    it("covers both halves by default", () => {
        const text = reportSummaryLines(report).join("\n");
        expect(text).toContain("Gear");
        expect(text).toContain("Rollen");
    });

    it("restricted to cla, leaves the RPB lines out", () => {
        const text = reportSummaryLines(report, "cla").join("\n");
        expect(text).toContain("Gear");
        expect(text).not.toContain("Rollen");
    });

    it("restricted to rpb, leaves the CLA lines out", () => {
        const text = reportSummaryLines(report, "rpb").join("\n");
        expect(text).not.toContain("Gear");
        expect(text).toContain("Rollen");
    });

    it("always names the raider count", () => {
        expect(reportSummaryLines(report, "rpb")[0]).toContain("Raider");
    });
});
