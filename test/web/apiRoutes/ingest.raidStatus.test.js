// POST /api/ingest/raids — the loot-sync tool's raid-list endpoint. Same
// token auth as ingestLoot (test/web/ingestRoute.test.js), so only the parts
// specific to this route are re-tested here: the route wiring/auth is driven
// through the real router, and computeRaidStatus() (the actual done/ready/
// empty decision) is also tested directly with plain object literals, since
// it is pure and needs no mocking at all.
const { mockRes, status, json, jsonRequest } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: jest.requireActual("../../../src/stores/ingestTokenStore").bearerFrom,
}));
jest.mock("../../../src/stores/lootInboxStore", () => ({
    upsertPending: jest.fn(),
    resolutionFor: jest.fn(() => null),
    listPending: jest.fn(() => []),
    getPending: jest.fn(),
    resolvePending: jest.fn(),
    pendingCount: jest.fn(() => 0),
    noteAppended: jest.fn(),
    listLinked: jest.fn(() => []),
}));
jest.mock("../../../src/stores/lootStore", () => ({
    addImport: jest.fn(),
    listByEvent: jest.fn(() => []),
    listByCharacter: jest.fn(() => []),
    listAll: jest.fn(() => []),
    eventsWithLoot: jest.fn(() => []),
    clearEvent: jest.fn(),
    setEventCategory: jest.fn(),
    removeItems: jest.fn(),
    repairItemNames: jest.fn(),
    characters: jest.fn(() => []),
}));
jest.mock("../../../src/web/characterInfo", () => ({
    rememberFromLoot: jest.fn(),
    annotatedCharacters: jest.fn(() => []),
    resolveMissing: jest.fn(),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
    eventLookbackSince: jest.fn(() => 0),
    EVENT_LOOKBACK_DAYS: 60,
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/utils/loot/wowhead", () => ({
    lookupItem: jest.fn(async () => null),
    searchItems: jest.fn(async () => []),
}));

const { verifyToken, touchToken } = require("../../../src/stores/ingestTokenStore");
const { resolutionFor, listPending } = require("../../../src/stores/lootInboxStore");
const { eventsWithLoot } = require("../../../src/stores/lootStore");
const { event: baseEvent } = require("../../factories/events");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { handle } = require("../../../src/web/http/apiRouter");
const { computeRaidStatus } = require("../../../src/web/apiRoutes/ingest");

async function request(jsonBody, authorization = "Bearer ehl_good") {
    const req = jsonRequest("POST", "/api/ingest/raids", jsonBody, authorization ? { authorization } : {});
    const res = mockRes();
    await handle("/api/ingest/raids", req, res);
    return res;
}

const SSC_SESSION = {
    sessionId: "eh-1784574000-ssc",
    startedAt: 1784574000000,
    endedAt: 1784581200000,
    instance: "Serpentshrine Cavern",
    items: 42,
    gargul: 42,
    rclc: 0,
    excluded: false,
};

beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue({ id: "t1", name: "Raidlead-PC" });
    resolutionFor.mockReturnValue(null);
    listPending.mockReturnValue([]);
    eventsWithLoot.mockReturnValue([]);
    loadEventGroups.mockResolvedValue({ groups: [] });
});

describe("POST /api/ingest/raids", () => {
    describe("authentication", () => {
        it("refuses a request without a token", async () => {
            const res = await request({ sessions: [] }, null);
            expect(status(res)).toBe(401);
            expect(json(res).error.code).toBe("no_token");
        });

        it("refuses a token the store does not know", async () => {
            verifyToken.mockReturnValue(null);
            const res = await request({ sessions: [] });
            expect(status(res)).toBe(401);
            expect(json(res).error.code).toBe("bad_token");
        });

        it("records the use of an accepted token", async () => {
            await request({ sessions: [] });
            expect(touchToken).toHaveBeenCalledWith("t1");
        });
    });

    it("returns the recent events with per-event status", async () => {
        loadEventGroups.mockResolvedValue({
            groups: [{
                categoryId: "cat1",
                categoryName: "Raids",
                events: [{ id: "e1", title: "SSC", startTime: 1784574000, source: "raidhelper" }],
            }],
        });
        const res = await request({ sessions: [SSC_SESSION] });
        expect(status(res)).toBe(200);
        expect(json(res).data.raids).toEqual([{
            eventId: "e1",
            title: "SSC",
            startTime: 1784574000,
            categoryId: "cat1",
            categoryName: "Raids",
            source: "raidhelper",
            status: "ready",
            matchedSessionId: "eh-1784574000-ssc",
            itemCount: 42,
            gargul: 42,
            rclc: 0,
        }]);
    });

    it("treats an event already in the loot history as done, ignoring local sessions", async () => {
        loadEventGroups.mockResolvedValue({
            groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "SSC", startTime: 1784574000 }] }],
        });
        eventsWithLoot.mockReturnValue([{ eventId: "e1" }]);
        const res = await request({ sessions: [SSC_SESSION] });
        expect(json(res).data.raids[0]).toMatchObject({ status: "done", matchedSessionId: null });
    });

    it("passes the local sessions through to the day-match", async () => {
        loadEventGroups.mockResolvedValue({ groups: [] });
        await request({ sessions: [SSC_SESSION] });
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 0 });
    });

    it("defaults to an empty session list", async () => {
        const res = await request({});
        expect(status(res)).toBe(200);
        expect(json(res).data.raids).toEqual([]);
    });
});

// computeRaidStatus() itself: pure, no mocking needed.
describe("computeRaidStatus", () => {
    const known = (over = {}) => ({
        lootedEventIds: new Set(),
        pending: [],
        resolutionFor: () => null,
        ...over,
    });

    const event = (over = {}) => baseEvent({ title: "SSC", startTime: 1000, source: "raidhelper", categoryId: "c1", categoryName: "Raids", ...over });
    const session = (over = {}) => ({ sessionId: "s1", startedAt: 1000 * 1000, items: 10, gargul: 10, rclc: 0, excluded: false, ...over });

    it("is 'empty' when nothing matches and nothing is stored", () => {
        const [raid] = computeRaidStatus([event()], [], known());
        expect(raid).toMatchObject({ status: "empty", matchedSessionId: null });
    });

    it("is 'ready' when a local session falls on the event's day", () => {
        const [raid] = computeRaidStatus([event()], [session()], known());
        expect(raid).toMatchObject({ status: "ready", matchedSessionId: "s1", itemCount: 10, gargul: 10, rclc: 0 });
    });

    it("is 'done' when the event already has loot in the history, even with a matching local session", () => {
        const [raid] = computeRaidStatus([event()], [session()], known({ lootedEventIds: new Set(["e1"]) }));
        expect(raid).toMatchObject({ status: "done", matchedSessionId: null });
    });

    it("is 'done' when a local session was already accepted into the event", () => {
        const [raid] = computeRaidStatus([event()], [session()], known({
            resolutionFor: (id) => (id === "s1" ? { eventId: "e1", action: "accepted" } : null),
        }));
        expect(raid).toMatchObject({ status: "done" });
    });

    it("is 'done' when a session is only pending, so a raidleader is never asked to upload twice", () => {
        const [raid] = computeRaidStatus([event()], [session()], known({
            pending: [{ sessionId: "s1", match: { suggested: { eventId: "e1" } } }],
        }));
        expect(raid).toMatchObject({ status: "done" });
    });

    it("ignores an excluded session", () => {
        const [raid] = computeRaidStatus([event()], [session({ excluded: true })], known());
        expect(raid).toMatchObject({ status: "empty" });
    });

    it("never proposes an already-sent session as ready for a different event", () => {
        const events = [event({ id: "e1", startTime: 1000 }), event({ id: "e2", startTime: 2000 })];
        const raids = computeRaidStatus(events, [session({ sessionId: "s1", startedAt: 1000 * 1000 })], known({
            pending: [{ sessionId: "s1", match: { suggested: { eventId: "e1" } } }],
        }));
        expect(raids.find((r) => r.eventId === "e1")).toMatchObject({ status: "done" });
        expect(raids.find((r) => r.eventId === "e2")).toMatchObject({ status: "empty" });
    });

    it("leaves two same-day events without a ready match (ambiguous, like bestDayMatch)", () => {
        const events = [event({ id: "e1", startTime: 1000 }), event({ id: "e2", startTime: 1500 })];
        const raids = computeRaidStatus(events, [session()], known());
        expect(raids.every((r) => r.status === "empty")).toBe(true);
    });

    it("sorts newest event first", () => {
        const events = [event({ id: "old", startTime: 100 }), event({ id: "new", startTime: 200 })];
        const raids = computeRaidStatus(events, [], known());
        expect(raids.map((r) => r.eventId)).toEqual(["new", "old"]);
    });
});
