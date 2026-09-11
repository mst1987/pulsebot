// GET/POST /api/cla/recommendations/send: the DM send step.
const mockGetReport = jest.fn();
const mockSaveReport = jest.fn();
const mockSendApproved = jest.fn();
const mockSendStatus = jest.fn();
const mockAssignments = jest.fn(() => ({ c1: { u1: "Farin" } }));
let mockBody = {};
let mockUser = { id: "u1", name: "Lead", isAdmin: true };
let mockCsrf = true;
let mockClient = {};

jest.mock("../../src/web/reportStore.js", () => ({
    getReport: (...a) => mockGetReport(...a), saveReport: (...a) => mockSaveReport(...a), listReports: jest.fn(() => []), deleteReport: jest.fn(),
}));
jest.mock("../../src/web/apiMiddleware.js", () => ({
    requireAdmin: (req, res) => { if (mockUser) return mockUser; res.writeHead(401); res.end("{}"); return null; },
    requireCsrf: (req, res) => { if (mockCsrf) return true; res.writeHead(403); res.end("{}"); return false; },
    requireFullAdmin: () => mockUser,
}));
jest.mock("../../src/web/apiBody.js", () => ({ readJsonBody: jest.fn(async () => mockBody) }));
jest.mock("../../src/web/recommendationSend.js", () => ({ sendApproved: (...a) => mockSendApproved(...a), sendStatus: (...a) => mockSendStatus(...a) }));
jest.mock("../../src/web/raiderCharactersStore.js", () => ({ listAllAssignments: () => mockAssignments() }));
jest.mock("../../src/web/discord.js", () => ({ getClient: () => mockClient, sendDirectMessage: jest.fn(), embed: jest.fn() }));
jest.mock("../../src/web/activeGuild.js", () => ({ activeGuildFor: () => "g1" }));
jest.mock("../../src/web/reportList.js", () => ({ prepareReportList: jest.fn(), prepareLogList: jest.fn(), annotateLogCategories: jest.fn(), annotateReportEvents: jest.fn() }));
jest.mock("../../src/web/logStore.js", () => ({ listLogs: jest.fn(), getLog: jest.fn(), getByReportRefId: jest.fn(), deleteLog: jest.fn(), clearEvaluation: jest.fn(), clearSection: jest.fn(), evaluatedSections: jest.fn(), linkEvent: jest.fn(), unlinkEvent: jest.fn() }));
jest.mock("../../src/web/logEventMatch.js", () => ({ annotateMatches: jest.fn(), autoMatches: jest.fn() }));
jest.mock("../../src/web/logChannel.js", () => ({ evaluateLog: jest.fn(), scanLogChannels: jest.fn(), backfillLogTitles: jest.fn() }));
jest.mock("../../src/web/evalJobs.js", () => ({ startJob: jest.fn(), getJob: jest.fn() }));
jest.mock("../../src/web/settingsStore.js", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/utils/logcheck/report.js", () => ({ buildReport: jest.fn(), stripSection: jest.fn(), ReportError: class extends Error {} }));
jest.mock("../../src/web/matchableEvents.js", () => ({ loadMatchableEvents: jest.fn(), eventLinkFields: jest.fn() }));
jest.mock("../../src/web/manualLog.js", () => ({ linkLogByUrl: jest.fn() }));

const { recommendationSendStatus, sendRecommendations } = require("../../src/web/apiRoutes/cla.js");

function res() {
    const r = { status: 0, body: "", writeHead(s) { r.status = s; }, end(b) { r.body = b || ""; } };
    r.json = () => JSON.parse(r.body || "{}");
    return r;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "u1", name: "Lead", isAdmin: true };
    mockCsrf = true;
    mockClient = {};
    mockBody = {};
    mockGetReport.mockImplementation((id) => (id === "abc123" ? { id: "abc123", recommendations: { raid: [], players: [] } } : null));
    mockSendApproved.mockImplementation(async (report) => ({ sent: [{ name: "Farin", userId: "u1", items: 2 }], skipped: [{ name: "Nomap", reason: "no_mapping", message: "x" }], report: { ...report, recommendationSent: { Farin: { at: 1 } } } }));
    mockSendStatus.mockReturnValue([{ name: "Farin", approved: 2, mapped: true }]);
});

describe("GET /api/cla/recommendations/send", () => {
    it("returns the per-raider send status from the assignments", async () => {
        const r = res();
        await recommendationSendStatus({}, r, new URL("http://x/api/cla/recommendations/send?id=abc123"));
        expect(r.status).toBe(200);
        expect(r.json().data.players).toEqual([{ name: "Farin", approved: 2, mapped: true }]);
        expect(mockSendStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "abc123" }), { c1: { u1: "Farin" } });
    });

    it("404s an unknown report", async () => {
        const r = res();
        await recommendationSendStatus({}, r, new URL("http://x/api/cla/recommendations/send?id=nope"));
        expect(r.status).toBe(404);
    });
});

describe("POST /api/cla/recommendations/send", () => {
    it("sends through the module, saves the updated report and summarises", async () => {
        mockBody = { reportId: "abc123" };
        const r = res();
        await sendRecommendations({}, r);
        expect(r.status).toBe(200);
        const { data } = r.json();
        expect(data.message).toBe("1 Raider angeschrieben, 1 übersprungen.");
        expect(data.sent).toHaveLength(1);
        const opts = mockSendApproved.mock.calls[0][1];
        expect(opts.by).toBe("Lead");
        expect(opts.force).toBe(false);
        expect(opts.only).toBeNull();
        expect(mockSaveReport).toHaveBeenCalledWith(expect.objectContaining({ recommendationSent: { Farin: { at: 1 } } }), "abc123");
    });

    it("passes the named raiders and force through", async () => {
        mockBody = { reportId: "abc123", players: ["Farin", "", 7], force: true };
        await sendRecommendations({}, res());
        const opts = mockSendApproved.mock.calls[0][1];
        expect(opts.only).toEqual(["Farin", "7"]);
        expect(opts.force).toBe(true);
    });

    it("words an empty send by its reason", async () => {
        mockSendApproved.mockResolvedValueOnce({ sent: [], skipped: [{ name: "Farin", reason: "already_sent", message: "x" }], report: {} });
        mockBody = { reportId: "abc123" };
        const r = res();
        await sendRecommendations({}, r);
        expect(r.json().data.message).toBe("Nichts gesendet – siehe Gründe.");
        mockSendApproved.mockResolvedValueOnce({ sent: [], skipped: [], report: {} });
        const r2 = res();
        await sendRecommendations({}, r2);
        expect(r2.json().data.message).toBe("Nichts freigegeben.");
    });

    it("refuses without the bot, without CSRF, and on an unknown report", async () => {
        mockClient = null;
        mockBody = { reportId: "abc123" };
        let r = res();
        await sendRecommendations({}, r);
        expect(r.status).toBe(503);
        expect(mockSendApproved).not.toHaveBeenCalled();

        mockClient = {};
        mockCsrf = false;
        r = res();
        await sendRecommendations({}, r);
        expect(r.status).toBe(403);

        mockCsrf = true;
        mockBody = { reportId: "zzz" };
        r = res();
        await sendRecommendations({}, r);
        expect(r.status).toBe(404);
        expect(mockSaveReport).not.toHaveBeenCalled();
    });
});
