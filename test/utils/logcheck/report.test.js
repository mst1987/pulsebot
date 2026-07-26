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
jest.mock("../../../src/utils/logcheck/common.js", () => ({ selectPlayers: jest.fn(() => []) }));
const mockSaveReport = jest.fn();
jest.mock("../../../src/web/reportStore.js", () => ({ saveReport: (...args) => mockSaveReport(...args) }));
jest.mock("../../../src/config/variables.js", () => ({ publicBaseUrl: "http://localhost:3005" }));

const { buildReport, ReportError } = require("../../../src/utils/logcheck/report.js");

beforeEach(() => {
    jest.clearAllMocks();
    mockParseReportId.mockImplementation((link) => String(link || "").trim() || null);
    mockGetFights.mockResolvedValue({ title: "SSC + TK", zoneName: "Serpentshrine Cavern", start: 0, end: 100 });
    mockGetCasts.mockResolvedValue({ entries: [] });
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
});
