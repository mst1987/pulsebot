jest.mock("../../../src/web/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: { id: "1" } }));
jest.mock("../../../src/web/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/talkOverview", () => ({
    overviewStatus: jest.fn(() => [{ guildId: "111", label: "PvE", configured: true, messageId: "m1" }]),
    currentPayload: jest.fn(async () => ({ payload: { embeds: [{ title: "Kommende Raids" }] }, error: null })),
    syncOverview: jest.fn(async () => ({ guildId: "111", label: "PvE", status: "posted", messageId: "m2" })),
}));

const { requireFullAdmin, requireCsrf } = require("../../../src/web/apiMiddleware");
const { readJsonBody } = require("../../../src/web/apiBody");
const talkOverview = require("../../../src/web/talkOverview");
const { getTalkOverview, postTalkOverview } = require("../../../src/web/apiRoutes/talkOverview");
const { AREA_BY_PATH } = require("../../../src/web/apiAccess");

const { mockRes, status, body } = require("../../helpers/http");

describe("apiRoutes/talkOverview", () => {
    beforeEach(() => jest.clearAllMocks());

    it("is gated as a settings path", () => {
        expect(AREA_BY_PATH["/api/settings/talk-overview"]).toBe("settings");
    });

    it("GET without a guildId answers with every configured entry's status, no preview built", async () => {
        const res = mockRes();
        await getTalkOverview({}, res, new URL("http://x/api/settings/talk-overview"));
        expect(body(res)).toEqual({ statuses: [{ guildId: "111", label: "PvE", configured: true, messageId: "m1" }] });
        expect(talkOverview.currentPayload).not.toHaveBeenCalled();
        expect(talkOverview.syncOverview).not.toHaveBeenCalled();
    });

    it("GET with a guildId answers with that entry's status and a dry-run preview, sending nothing", async () => {
        const res = mockRes();
        await getTalkOverview({}, res, new URL("http://x/api/settings/talk-overview?guildId=111"));
        expect(body(res)).toEqual({
            status: { guildId: "111", label: "PvE", configured: true, messageId: "m1" },
            preview: { embeds: [{ title: "Kommende Raids" }] },
            previewError: null,
        });
        expect(talkOverview.currentPayload).toHaveBeenCalledWith({ guildId: "111" });
    });

    it("GET names a status of null for a guildId with no configured entry", async () => {
        const res = mockRes();
        await getTalkOverview({}, res, new URL("http://x/api/settings/talk-overview?guildId=999"));
        expect(body(res).status).toBeNull();
    });

    it("GET skips the preview with ?preview=0", async () => {
        const res = mockRes();
        await getTalkOverview({}, res, new URL("http://x/api/settings/talk-overview?guildId=111&preview=0"));
        expect(talkOverview.currentPayload).not.toHaveBeenCalled();
        expect(body(res).preview).toBeNull();
    });

    it("POST re-posts on request and returns the new status", async () => {
        readJsonBody.mockResolvedValue({ guildId: "111", repost: true });
        const res = mockRes();
        await postTalkOverview({}, res);
        expect(talkOverview.syncOverview).toHaveBeenCalledWith({ repost: true, guildId: "111" });
        expect(body(res).result).toEqual({ guildId: "111", label: "PvE", status: "posted", messageId: "m2" });
        expect(body(res).status).toEqual({ guildId: "111", label: "PvE", configured: true, messageId: "m1" });
    });

    it("POST refuses without a guildId in the body", async () => {
        readJsonBody.mockResolvedValue({});
        const res = mockRes();
        await postTalkOverview({}, res);
        expect(status(res)).toBe(400);
        expect(talkOverview.syncOverview).not.toHaveBeenCalled();
    });

    it("POST refuses for a guildId with no configured overview target", async () => {
        readJsonBody.mockResolvedValue({ guildId: "111" });
        talkOverview.syncOverview.mockResolvedValueOnce({ status: "unconfigured" });
        const res = mockRes();
        await postTalkOverview({}, res);
        expect(status(res)).toBe(400);
    });

    it("needs a full admin and the CSRF token", async () => {
        requireFullAdmin.mockReturnValueOnce(null);
        await postTalkOverview({}, mockRes());
        requireCsrf.mockReturnValueOnce(false);
        await postTalkOverview({}, mockRes());
        expect(talkOverview.syncOverview).not.toHaveBeenCalled();
    });
});
