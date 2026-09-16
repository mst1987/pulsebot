jest.mock("../../src/web/apiMiddleware", () => ({
    requireFullAdmin: jest.fn(() => ({ id: "1" })),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn(async () => ({})) }));
jest.mock("../../src/web/talkOverview", () => ({
    overviewStatus: jest.fn(() => ({ configured: true, messageId: "m1" })),
    currentPayload: jest.fn(async () => ({ payload: { embeds: [{ title: "Kommende Raids" }] }, error: null })),
    syncOverview: jest.fn(async () => ({ status: "posted", messageId: "m2" })),
}));

const { requireFullAdmin, requireCsrf } = require("../../src/web/apiMiddleware");
const { readJsonBody } = require("../../src/web/apiBody");
const talkOverview = require("../../src/web/talkOverview");
const { getTalkOverview, postTalkOverview } = require("../../src/web/apiRoutes/talkOverview");
const { AREA_BY_PATH } = require("../../src/web/apiAccess");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
const bodyOf = (res) => JSON.parse(res.end.mock.calls[0][0]);

describe("apiRoutes/talkOverview", () => {
    beforeEach(() => jest.clearAllMocks());

    it("is gated as a settings path", () => {
        expect(AREA_BY_PATH["/api/settings/talk-overview"]).toBe("settings");
    });

    it("GET answers with the status and a dry-run preview, sending nothing", async () => {
        const res = mockRes();
        await getTalkOverview({}, res, new URL("http://x/api/settings/talk-overview"));
        expect(bodyOf(res).data).toEqual({
            status: { configured: true, messageId: "m1" },
            preview: { embeds: [{ title: "Kommende Raids" }] },
            previewError: null,
        });
        expect(talkOverview.syncOverview).not.toHaveBeenCalled();
    });

    it("GET skips the preview with ?preview=0", async () => {
        const res = mockRes();
        await getTalkOverview({}, res, new URL("http://x/api/settings/talk-overview?preview=0"));
        expect(talkOverview.currentPayload).not.toHaveBeenCalled();
        expect(bodyOf(res).data.preview).toBeNull();
    });

    it("POST re-posts on request and returns the new status", async () => {
        readJsonBody.mockResolvedValue({ repost: true });
        const res = mockRes();
        await postTalkOverview({}, res);
        expect(talkOverview.syncOverview).toHaveBeenCalledWith({ repost: true });
        expect(bodyOf(res).data.result).toEqual({ status: "posted", messageId: "m2" });
    });

    it("POST refuses without a configured overview channel", async () => {
        talkOverview.syncOverview.mockResolvedValueOnce({ status: "unconfigured" });
        const res = mockRes();
        await postTalkOverview({}, res);
        expect(res.writeHead.mock.calls[0][0]).toBe(400);
    });

    it("needs a full admin and the CSRF token", async () => {
        requireFullAdmin.mockReturnValueOnce(null);
        await postTalkOverview({}, mockRes());
        requireCsrf.mockReturnValueOnce(false);
        await postTalkOverview({}, mockRes());
        expect(talkOverview.syncOverview).not.toHaveBeenCalled();
    });
});
