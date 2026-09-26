// GET/POST /api/cla/recommendations/phrase: the Claude phrasing job.
const mockGetReport = jest.fn();
const mockSaveReport = jest.fn();
const mockPhraseReport = jest.fn();
const mockStartJob = jest.fn();
const mockGetJob = jest.fn();
let mockConfig = { anthropic: { apiKey: "sk-test", model: "" } };
let mockBody = {};
let mockUser = { id: "u1", name: "Lead", isAdmin: true };
let mockCsrf = true;

jest.mock("../../../src/stores/reportStore.js", () => ({
    getReport: (...a) => mockGetReport(...a), saveReport: (...a) => mockSaveReport(...a), listReports: jest.fn(() => []), deleteReport: jest.fn(),
}));
jest.mock("../../../src/web/http/apiMiddleware.js", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser, csrf: () => mockCsrf, fullAdmin: () => mockUser }));
jest.mock("../../../src/web/http/apiBody.js", () => require("../../helpers/http").apiBodyMock({ body: () => mockBody }));
jest.mock("../../../src/utils/logcheck/recommendationText.js", () => ({ phraseReport: (...a) => mockPhraseReport(...a) }));
jest.mock("../../../src/web/logcheck/evalJobs.js", () => ({ startJob: (...a) => mockStartJob(...a), getJob: (...a) => mockGetJob(...a) }));
jest.mock("../../../src/stores/settingsStore.js", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/web/logcheck/recommendationSend.js", () => ({ sendApproved: jest.fn(), sendStatus: jest.fn() }));
jest.mock("../../../src/stores/raiderCharactersStore.js", () => ({ listAllAssignments: () => ({}) }));
jest.mock("../../../src/services/discord/discord.js", () => ({ getClient: () => ({}) }));
jest.mock("../../../src/web/http/activeGuild.js", () => ({ activeGuildFor: () => "g1" }));
jest.mock("../../../src/services/logcheck/reportList.js", () => ({ prepareReportList: jest.fn(), prepareLogList: jest.fn(), annotateLogCategories: jest.fn(), annotateReportEvents: jest.fn() }));
jest.mock("../../../src/stores/logStore.js", () => ({ listLogs: jest.fn(), getLog: jest.fn(), getByReportRefId: jest.fn(), deleteLog: jest.fn(), clearEvaluation: jest.fn(), clearSection: jest.fn(), evaluatedSections: jest.fn(), linkEvent: jest.fn(), unlinkEvent: jest.fn() }));
jest.mock("../../../src/services/logcheck/logEventMatch.js", () => ({ annotateMatches: jest.fn(), autoMatches: jest.fn() }));
jest.mock("../../../src/services/logcheck/logChannel.js", () => ({ evaluateLog: jest.fn(), scanLogChannels: jest.fn(), backfillLogTitles: jest.fn() }));
jest.mock("../../../src/utils/logcheck/report.js", () => ({ buildReport: jest.fn(), stripSection: jest.fn(), ReportError: class extends Error {} }));
jest.mock("../../../src/services/logcheck/matchableEvents.js", () => ({ loadMatchableEvents: jest.fn(), eventLinkFields: jest.fn() }));
jest.mock("../../../src/web/logcheck/manualLog.js", () => ({ linkLogByUrl: jest.fn() }));

const { phraseRecommendations, phraseStatus } = require("../../../src/web/apiRoutes/cla.js");

const { mockRes, status, json } = require("../../helpers/http");

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "u1", name: "Lead", isAdmin: true };
    mockCsrf = true;
    mockBody = {};
    mockConfig = { anthropic: { apiKey: "sk-test", model: "" } };
    mockGetReport.mockImplementation((id) => (id === "abc123" ? { id: "abc123", recommendations: { raid: [], players: [] }, recommendationPhrase: { at: 1, model: "m", phrased: 3, players: 2, errors: [] } } : null));
    mockStartJob.mockReturnValue({ status: "running", alreadyRunning: false });
    mockPhraseReport.mockResolvedValue({ phrased: 3, players: 2, errors: [], model: "claude-opus-5" });
});

describe("POST /api/cla/recommendations/phrase", () => {
    it("starts a background job that phrases with the stored key and saves the report", async () => {
        mockBody = { reportId: "abc123", players: ["Farin"] };
        const r = mockRes();
        await phraseRecommendations({}, r);
        expect(status(r)).toBe(202);
        expect(json(r).data).toEqual({ reportId: "abc123", status: "running", alreadyRunning: false });
        expect(mockStartJob).toHaveBeenCalledWith("abc123", "phrase", expect.any(Function));

        const runner = mockStartJob.mock.calls[0][2];
        const outcome = await runner();
        expect(mockPhraseReport).toHaveBeenCalledWith(expect.objectContaining({ id: "abc123" }), { apiKey: "sk-test", model: undefined, only: ["Farin"] });
        expect(mockSaveReport).toHaveBeenCalledWith(expect.objectContaining({ id: "abc123" }), "abc123");
        expect(outcome).toEqual({ ok: true, id: "abc123", url: "3" });
    });

    it("passes a configured model through and answers 200 when the job already runs", async () => {
        mockConfig = { anthropic: { apiKey: "sk-test", model: "claude-sonnet-5" } };
        mockStartJob.mockReturnValue({ status: "running", alreadyRunning: true });
        mockBody = { reportId: "abc123" };
        const r = mockRes();
        await phraseRecommendations({}, r);
        expect(status(r)).toBe(200);
        await mockStartJob.mock.calls[0][2]();
        expect(mockPhraseReport.mock.calls[0][1]).toEqual({ apiKey: "sk-test", model: "claude-sonnet-5", only: null });
    });

    it("refuses without a key, without CSRF, and on an unknown report", async () => {
        mockConfig = { anthropic: { apiKey: "", model: "" } };
        mockBody = { reportId: "abc123" };
        let r = mockRes();
        await phraseRecommendations({}, r);
        expect(status(r)).toBe(400);
        expect(json(r).error.code).toBe("no_api_key");
        expect(mockStartJob).not.toHaveBeenCalled();

        mockConfig = { anthropic: { apiKey: "sk-test" } };
        mockCsrf = false;
        r = mockRes();
        await phraseRecommendations({}, r);
        expect(status(r)).toBe(403);

        mockCsrf = true;
        mockBody = { reportId: "nope" };
        r = mockRes();
        await phraseRecommendations({}, r);
        expect(status(r)).toBe(404);
    });
});

describe("GET /api/cla/recommendations/phrase", () => {
    it("returns the job state, the last run and whether a key is stored", async () => {
        mockGetJob.mockReturnValue({ status: "done", url: "3", error: "" });
        const r = mockRes();
        await phraseStatus({}, r, new URL("http://x/api/cla/recommendations/phrase?id=abc123"));
        expect(status(r)).toBe(200);
        expect(json(r).data).toEqual({ reportId: "abc123", job: { status: "done", url: "3", error: "" }, last: { at: 1, model: "m", phrased: 3, players: 2, errors: [] }, hasApiKey: true });
        expect(mockGetJob).toHaveBeenCalledWith("abc123", "phrase");
    });

    it("404s an unknown report", async () => {
        const r = mockRes();
        await phraseStatus({}, r, new URL("http://x/api/cla/recommendations/phrase?id=zzz"));
        expect(status(r)).toBe(404);
    });
});
