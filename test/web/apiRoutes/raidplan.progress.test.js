// GET /api/raidplan/progress (#534): the read view asks with its token (no login), the editor with its event
// (raidplan read). The derivation is mocked here — test/services/raidplan/raidplanProgress.test.js covers it.
let mockUser = null;
let mockViewer = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/auth", () => ({ getUser: jest.fn(() => mockViewer) }));
jest.mock("../../../src/services/raidplan/raidplanProgress", () => ({
    progressFor: jest.fn(async () => ({ live: true, killed: ["bt/high-warlord-najentus"], current: null, next: "bt/supremus", updatedAt: 5 })),
}));
const mockEvents = {};
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh_")),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../factories/events");
const store = require("../../../src/stores/raidplanStore");
const route = require("../../../src/web/apiRoutes/raidplan");
const { progressFor } = require("../../../src/services/raidplan/raidplanProgress");
const { checkAccess, UNGATED } = require("../../../src/web/http/apiAccess");
const { mockRes, status, json } = require("../../helpers/http");

const ORGA = { id: "orga", isAdmin: false, access: { raidplan: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raidplan: { read: true, write: false } } };
const MEMBER = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
const body = (r) => { const p = json(r); return p.data || p.error; };

async function progressGet(query, viewer = null) {
    mockViewer = viewer;
    const r = mockRes();
    await route.getProgress({ headers: {} }, r, new URL(`http://x/api/raidplan/progress?${query}`));
    return r;
}

async function publish() {
    mockUser = ORGA;
    readJsonBody.mockResolvedValue({ event: "eh_1", version: 0, bosses: { "bt/supremus": { notes: "Hi" } } });
    await route.putPlan({ headers: {} }, mockRes(), new URL("http://x/api/raidplan"));
    readJsonBody.mockResolvedValue({ event: "eh_1", published: true });
    const r = mockRes();
    await route.postPublish({ headers: {} }, r, new URL("http://x/api/raidplan/publish"));
    return body(r).plan.publicPath.replace("/p/", "");
}

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("raidplans.json"));
    mockViewer = null;
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    mockEvents.eh_1 = ownEvent({ id: "eh_1", title: "Black Temple", startTime: 1800000000, instanceIds: ["bt"] });
});
afterAll(() => store.useFile());

describe("GET /api/raidplan/progress", () => {
    it("is not behind the area gate: the token is its own authentication", () => {
        expect(UNGATED.has("/api/raidplan/progress")).toBe(true);
        expect(checkAccess("/api/raidplan/progress", "GET", null)).toBeNull();
    });

    it("answers the read view by its token, without a login", async () => {
        const token = await publish();
        const r = await progressGet(`token=${token}`);
        expect(status(r)).toBe(200);
        expect(body(r)).toEqual({ live: true, killed: ["bt/high-warlord-najentus"], current: null, next: "bt/supremus", updatedAt: 5 });
        expect(progressFor).toHaveBeenCalledWith(expect.objectContaining({ id: "eh_1", instanceIds: ["bt"] }));
    });

    it("answers the same 404 as /public for an unknown or withdrawn link", async () => {
        expect(status(await progressGet("token=aaaaaaaaaaaaaaaaaaaaaaaa"))).toBe(404);
        const token = await publish();
        readJsonBody.mockResolvedValue({ event: "eh_1", published: false });
        await route.postPublish({ headers: {} }, mockRes(), new URL("http://x/api/raidplan/publish"));
        expect(status(await progressGet(`token=${token}`))).toBe(404);
        expect(progressFor).not.toHaveBeenCalled();
    });

    it("answers the editor by its event for raidplan read, never for others", async () => {
        const ok = await progressGet("event=eh_1", READER);
        expect(status(ok)).toBe(200);
        expect(body(ok).next).toBe("bt/supremus");
        expect(status(await progressGet("event=eh_1", null))).toBe(401);
        expect(status(await progressGet("event=eh_1", MEMBER))).toBe(403);
        expect(status(await progressGet("event=eh_missing", READER))).toBe(404);
        expect(progressFor).toHaveBeenCalledTimes(1);
    });
});
