// POST /api/raids/post-raidplan (#502) — "Einteilungen posten": the route only
// resolves the event server-side and hands it to the service
// (test/services/raidplan/raidplanPost.test.js covers the posting itself).
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({
    user: { id: "u-lead", name: "Nerathil", isAdmin: true },
    fullAdmin: { id: "u-lead", isAdmin: true },
}));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(),
    eventLookbackSince: jest.fn(() => 0),
}));
jest.mock("../../../src/services/raidplan/raidplanPost", () => ({ postRaidplanLink: jest.fn(), raidplanPostState: jest.fn(() => null) }));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { requireCsrf } = require("../../../src/web/http/apiMiddleware");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { postRaidplanLink } = require("../../../src/services/raidplan/raidplanPost");
const { postPostRaidplan, routes } = require("../../../src/web/apiRoutes/raidDetail");
const { mockRes, status, json } = require("../../helpers/http");

const EVENT = { id: "eh-1", source: "eventhelper", title: "Karazhan", channelId: "chan1", startTime: 1800000000 };

beforeEach(() => {
    jest.clearAllMocks();
    loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [EVENT] }], error: null });
});

describe("POST /api/raids/post-raidplan", () => {
    // It publishes the plan on the way: a raid plan write, whoever runs the event.
    it("is a raidplan route", () => {
        expect(routes).toContainEqual({ method: "POST", path: "/api/raids/post-raidplan", handler: postPostRaidplan, area: "raidplan" });
    });

    it("hands the server's own event, the message and the caller to the service", async () => {
        postRaidplanLink.mockResolvedValue({ body: { message: "Einteilungen in den Kanal gepostet.", updated: false } });
        readJsonBody.mockResolvedValue({ event: "eh-1", message: "Bitte lesen", channelId: "evil" });
        const r = mockRes();
        await postPostRaidplan({}, r);
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 0 });
        expect(postRaidplanLink).toHaveBeenCalledWith({ event: EVENT, message: "Bitte lesen", userId: "u-lead" });
        expect(status(r)).toBe(200);
        expect(json(r).data).toEqual({ message: "Einteilungen in den Kanal gepostet.", updated: false });
    });

    it("leaves the message undefined when the body has none, and cuts a long one", async () => {
        postRaidplanLink.mockResolvedValue({ body: { message: "ok" } });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        await postPostRaidplan({}, mockRes());
        expect(postRaidplanLink.mock.calls[0][0].message).toBeUndefined();
        readJsonBody.mockResolvedValue({ event: "eh-1", message: "x".repeat(900) });
        await postPostRaidplan({}, mockRes());
        expect(postRaidplanLink.mock.calls[1][0].message).toHaveLength(500);
    });

    it("answers 404 for an unknown event and 400 when the events cannot be loaded", async () => {
        readJsonBody.mockResolvedValue({ event: "weg" });
        const r = mockRes();
        await postPostRaidplan({}, r);
        expect(status(r)).toBe(404);
        expect(json(r).error.code).toBe("not_found");
        loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper down" });
        const r2 = mockRes();
        await postPostRaidplan({}, r2);
        expect(status(r2)).toBe(400);
        expect(json(r2).error.code).toBe("events_unavailable");
        expect(postRaidplanLink).not.toHaveBeenCalled();
    });

    it("passes the service's refusal on with its status", async () => {
        postRaidplanLink.mockResolvedValue({ error: { status: 400, code: "empty_plan", message: "Der Raidplan ist noch leer." } });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = mockRes();
        await postPostRaidplan({}, r);
        expect(status(r)).toBe(400);
        expect(json(r).error.code).toBe("empty_plan");
    });

    it("wants the CSRF token", async () => {
        requireCsrf.mockReturnValueOnce(false);
        await postPostRaidplan({}, mockRes());
        expect(postRaidplanLink).not.toHaveBeenCalled();
    });
});
