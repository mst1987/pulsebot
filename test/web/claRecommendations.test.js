// GET/POST /api/cla/recommendations: the raid lead's verdicts on the findings.
const mockGetReport = jest.fn();
const mockSaveReport = jest.fn();
let mockBody = {};
let mockUser = { id: "u1", name: "Lead", isAdmin: true };
let mockCsrf = true;

jest.mock("../../src/web/reportStore.js", () => ({
    getReport: (...a) => mockGetReport(...a),
    saveReport: (...a) => mockSaveReport(...a),
    listReports: jest.fn(() => []),
    deleteReport: jest.fn(),
}));
jest.mock("../../src/web/apiMiddleware.js", () => ({
    requireAdmin: (req, res) => { if (mockUser) return mockUser; res.writeHead(401); res.end("{}"); return null; },
    requireCsrf: (req, res) => { if (mockCsrf) return true; res.writeHead(403); res.end("{}"); return false; },
    requireFullAdmin: () => mockUser,
}));
jest.mock("../../src/web/apiBody.js", () => ({ readJsonBody: jest.fn(async () => mockBody) }));
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
jest.mock("../../src/web/discord.js", () => ({}));

const { getRecommendations, reviewRecommendation } = require("../../src/web/apiRoutes/cla.js");

function res() {
    const r = { status: 0, body: "", writeHead(s) { r.status = s; }, end(b) { r.body = b || ""; } };
    r.json = () => JSON.parse(r.body || "{}");
    return r;
}

function report() {
    return {
        id: "abc123", title: "Gruul",
        recommendations: {
            generatedAt: 1,
            raid: [{ key: "raid.earlyDeaths", impact: "high", title: "2 frühe Tode", text: "…", evidence: [] }],
            players: [{ name: "Farin", type: "Warlock", items: [{ key: "gear", impact: "high", title: "Gear", text: "…", evidence: [] }] }],
        },
        recommendationReview: { raid: {}, players: { Farin: { gear: { approved: true, text: "Bitte fixen." } } } },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "u1", name: "Lead", isAdmin: true };
    mockCsrf = true;
    mockBody = {};
    mockGetReport.mockImplementation((id) => (id === "abc123" ? report() : null));
});

describe("GET /api/cla/recommendations", () => {
    it("returns the findings with the review laid over them", async () => {
        const r = res();
        await getRecommendations({}, r, new URL("http://x/api/cla/recommendations?id=abc123"));
        expect(r.status).toBe(200);
        const { data } = r.json();
        expect(data.reportId).toBe("abc123");
        expect(data.recommendations.players[0].items[0]).toEqual(expect.objectContaining({ approved: true, custom: "Bitte fixen." }));
        expect(data.recommendations.raid[0].approved).toBeNull();
    });

    it("404s an unknown report and 401s without a user", async () => {
        const r = res();
        await getRecommendations({}, r, new URL("http://x/api/cla/recommendations?id=nope"));
        expect(r.status).toBe(404);
        mockUser = null;
        const r2 = res();
        await getRecommendations({}, r2, new URL("http://x/api/cla/recommendations?id=abc123"));
        expect(r2.status).toBe(401);
    });
});

describe("POST /api/cla/recommendations", () => {
    it("records a verdict on a player's finding and saves the report", async () => {
        mockBody = { reportId: "abc123", scope: "player", player: "Farin", key: "gear", approved: false };
        const r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(200);
        expect(r.json().data.review).toEqual(expect.objectContaining({ approved: false, text: "Bitte fixen.", by: "Lead" }));
        expect(mockSaveReport).toHaveBeenCalledTimes(1);
        const [saved, id] = mockSaveReport.mock.calls[0];
        expect(id).toBe("abc123");
        expect(saved.recommendationReview.players.Farin.gear.approved).toBe(false);
    });

    it("stores a rewritten text, trimmed and capped, without touching the verdict", async () => {
        mockBody = { reportId: "abc123", scope: "player", player: "Farin", key: "gear", text: `  ${"x".repeat(1200)}  ` };
        const r = res();
        await reviewRecommendation({}, r);
        const entry = r.json().data.review;
        expect(entry.approved).toBe(true);
        expect(entry.text).toHaveLength(1000);
    });

    it("takes a verdict back with approved: null", async () => {
        mockBody = { reportId: "abc123", scope: "player", player: "Farin", key: "gear", approved: null };
        const r = res();
        await reviewRecommendation({}, r);
        expect(r.json().data.review.approved).toBeUndefined();
    });

    it("reviews a raid-level finding under scope raid", async () => {
        mockBody = { reportId: "abc123", scope: "raid", key: "raid.earlyDeaths", approved: true };
        const r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(200);
        expect(mockSaveReport.mock.calls[0][0].recommendationReview.raid["raid.earlyDeaths"].approved).toBe(true);
    });

    it("refuses a finding the report does not have, a missing key, an unknown report and a bad CSRF token", async () => {
        mockBody = { reportId: "abc123", scope: "player", player: "Farin", key: "nope", approved: true };
        let r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(404);

        mockBody = { reportId: "abc123", scope: "player", player: "", key: "gear", approved: true };
        r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(400);

        mockBody = { reportId: "zzz", scope: "raid", key: "raid.earlyDeaths", approved: true };
        r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(404);

        mockCsrf = false;
        r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(403);
        expect(mockSaveReport).not.toHaveBeenCalled();
    });

    it("starts a review record on a report that has none", async () => {
        mockGetReport.mockImplementation(() => ({ ...report(), recommendationReview: undefined }));
        mockBody = { reportId: "abc123", scope: "player", player: "Farin", key: "gear", approved: true };
        const r = res();
        await reviewRecommendation({}, r);
        expect(r.status).toBe(200);
        expect(mockSaveReport.mock.calls[0][0].recommendationReview).toEqual({ raid: {}, players: { Farin: { gear: expect.objectContaining({ approved: true }) } } });
    });
});
