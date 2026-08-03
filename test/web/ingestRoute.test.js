// The loot-sync upload endpoint, driven through the real router so the access
// gate (apiAccess.js) is exercised together with the handler — the endpoint has
// no Discord session behind it, and that exemption is the risky part.
const { EventEmitter } = require("events");

// No session user anywhere in this file: the uploader is a machine.
jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../src/web/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: jest.requireActual("../../src/web/ingestTokenStore").bearerFrom,
}));
jest.mock("../../src/web/lootInboxStore", () => ({
    upsertPending: jest.fn(() => ({ entry: { id: "inbox1", itemCount: 1 }, added: 1, created: true })),
    resolutionFor: jest.fn(() => null),
    listPending: jest.fn(() => []),
    getPending: jest.fn(),
    resolvePending: jest.fn(),
    pendingCount: jest.fn(() => 0),
}));
jest.mock("../../src/web/lootStore", () => ({
    addImport: jest.fn(() => ({ added: 1, skipped: 0 })),
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
jest.mock("../../src/web/characterInfo", () => ({
    rememberFromLoot: jest.fn(),
    annotatedCharacters: jest.fn(() => []),
    resolveMissing: jest.fn(),
}));
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
    eventLookbackSince: jest.fn(() => 0),
    EVENT_LOOKBACK_DAYS: 30,
}));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
// Import-time item enrichment must never hit the network.
jest.mock("../../src/utils/wowhead", () => ({
    lookupItem: jest.fn(async () => null),
    searchItems: jest.fn(async () => []),
}));

const { verifyToken, touchToken } = require("../../src/web/ingestTokenStore");
const { upsertPending, resolutionFor } = require("../../src/web/lootInboxStore");
const { addImport } = require("../../src/web/lootStore");
const { loadEventGroups } = require("../../src/web/raidEventGroups");
const { handle } = require("../../src/web/apiRouter");
const { EH_FORMAT, EH_VERSION } = require("../../src/utils/lootImport");

const TOKEN = { id: "t1", name: "Raidlead-PC" };

const payload = (over = {}) => ({
    format: EH_FORMAT,
    version: EH_VERSION,
    realm: "Thunderstrike",
    reporter: "Gemli-Thunderstrike",
    client: { addon: "1.0.0", sync: "1.0.0" },
    sessions: [{
        sessionId: "eh-1784574000-ssc",
        startedAt: 1784574000,
        endedAt: 1784581200,
        instance: "Serpentshrine Cavern",
        items: [{
            source: "gargul", rawId: "sum1", itemId: 30242, player: "Keslight",
            class: "paladin", response: "Main Spec", offspec: false, awardedAt: 1784574375,
        }],
    }],
    ...over,
});

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
function body(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}
function status(res) {
    return res.writeHead.mock.calls[0][0];
}

async function upload(jsonBody, authorization = "Bearer ehl_good") {
    const req = new EventEmitter();
    req.method = "POST";
    req.headers = authorization ? { authorization } : {};
    const res = mockRes();
    const p = handle("/api/ingest/loot", req, res);
    req.emit("data", JSON.stringify(jsonBody));
    req.emit("end");
    await p;
    return res;
}

beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue(TOKEN);
    resolutionFor.mockReturnValue(null);
    upsertPending.mockReturnValue({ entry: { id: "inbox1", itemCount: 1 }, added: 1, created: true });
    addImport.mockReturnValue({ added: 1, skipped: 0 });
    loadEventGroups.mockResolvedValue({ groups: [] });
});

describe("POST /api/ingest/loot", () => {
    describe("authentication", () => {
        it("refuses an upload without a token", async () => {
            const res = await upload(payload(), null);
            expect(status(res)).toBe(401);
            expect(body(res).error.code).toBe("no_token");
            expect(upsertPending).not.toHaveBeenCalled();
        });

        it("refuses a token the store does not know", async () => {
            verifyToken.mockReturnValue(null);
            const res = await upload(payload());
            expect(status(res)).toBe(401);
            expect(body(res).error.code).toBe("bad_token");
            expect(upsertPending).not.toHaveBeenCalled();
        });

        // No Discord session is involved, so nothing else may be either.
        it("accepts a valid token with no logged-in user at all", async () => {
            const res = await upload(payload());
            expect(status(res)).toBe(201);
        });

        it("records the use of an accepted token", async () => {
            await upload(payload());
            expect(touchToken).toHaveBeenCalledWith("t1");
        });

        it("does not record a use for a rejected payload", async () => {
            await upload({ format: "something-else" });
            expect(touchToken).not.toHaveBeenCalled();
        });
    });

    describe("payload handling", () => {
        it("rejects anything that is not our envelope", async () => {
            const res = await upload({ nope: true });
            expect(status(res)).toBe(400);
            expect(body(res).error.code).toBe("parse_failed");
        });

        it("puts a new session into the inbox rather than into the loot history", async () => {
            const res = await upload(payload());
            expect(status(res)).toBe(201);
            expect(addImport).not.toHaveBeenCalled();
            expect(upsertPending).toHaveBeenCalledTimes(1);
            const [session, meta] = upsertPending.mock.calls[0];
            expect(session.sessionId).toBe("eh-1784574000-ssc");
            expect(session.items).toHaveLength(1);
            expect(meta).toMatchObject({
                realm: "Thunderstrike", reporter: "Gemli-Thunderstrike",
                addonVersion: "1.0.0", tokenId: "t1", tokenName: "Raidlead-PC",
            });
            expect(body(res).data.results[0]).toMatchObject({ status: "pending", inboxId: "inbox1" });
        });

        it("reports a re-upload as an update, not a new session", async () => {
            upsertPending.mockReturnValue({ entry: { id: "inbox1", itemCount: 3 }, added: 2, created: false });
            const res = await upload(payload());
            expect(body(res).data.results[0]).toMatchObject({ status: "updated", added: 2, total: 3 });
        });

        it("skips a session that carries no items", async () => {
            const data = payload();
            data.sessions[0].items = [];
            const res = await upload(data);
            expect(body(res).data.results[0]).toMatchObject({ status: "empty" });
            expect(upsertPending).not.toHaveBeenCalled();
        });

        it("handles several sessions in one upload", async () => {
            const data = payload();
            data.sessions.push({ ...data.sessions[0], sessionId: "eh-2-tk" });
            const res = await upload(data);
            expect(body(res).data.received).toBe(2);
            expect(upsertPending).toHaveBeenCalledTimes(2);
        });
    });

    // The decisions an admin already made must survive the sync tool re-sending
    // the same raid on every SavedVariables flush.
    describe("remembered decisions", () => {
        it("appends straight to the event an accepted session went to", async () => {
            resolutionFor.mockReturnValue({
                action: "accepted", eventId: "e1", eventLabel: "SSC", categoryId: "cat1",
            });
            const res = await upload(payload());
            expect(upsertPending).not.toHaveBeenCalled();
            expect(addImport).toHaveBeenCalledWith("e1", expect.any(Array), {
                categoryId: "cat1", eventLabel: "SSC",
            });
            expect(body(res).data.results[0]).toMatchObject({
                status: "appended", eventId: "e1", added: 1,
            });
        });

        it("silently drops a session that was dismissed", async () => {
            resolutionFor.mockReturnValue({ action: "dismissed" });
            const res = await upload(payload());
            expect(upsertPending).not.toHaveBeenCalled();
            expect(addImport).not.toHaveBeenCalled();
            expect(body(res).data.results[0]).toMatchObject({ status: "dismissed" });
        });
    });

    describe("event matching", () => {
        it("suggests the event whose start falls on the raid's day", async () => {
            loadEventGroups.mockResolvedValue({
                groups: [{
                    categoryId: "cat1",
                    categoryName: "Raids",
                    events: [{ id: "e1", title: "SSC", startTime: 1784574000 }],
                }],
            });
            await upload(payload());
            const [, meta] = upsertPending.mock.calls[0];
            expect(meta.match).toMatchObject({
                ambiguous: false,
                suggested: { eventId: "e1", eventLabel: "SSC", categoryId: "cat1", categoryName: "Raids" },
            });
        });

        it("flags two raids on the same day as ambiguous instead of guessing", async () => {
            loadEventGroups.mockResolvedValue({
                groups: [{
                    categoryId: "cat1",
                    categoryName: "Raids",
                    events: [
                        { id: "e1", title: "SSC", startTime: 1784574000 },
                        { id: "e2", title: "TK", startTime: 1784577000 },
                    ],
                }],
            });
            await upload(payload());
            const [, meta] = upsertPending.mock.calls[0];
            expect(meta.match.ambiguous).toBe(true);
            expect(meta.match.suggested).toBeNull();
            expect(meta.match.candidates.map((c) => c.eventId)).toEqual(["e1", "e2"]);
        });

        // Losing a raid's loot because Raid-Helper had a bad minute would be far
        // worse than losing the convenience of a pre-filled event.
        it("still stores the session when the event lookup fails", async () => {
            loadEventGroups.mockRejectedValue(new Error("Raid-Helper down"));
            const res = await upload(payload());
            expect(status(res)).toBe(201);
            expect(upsertPending).toHaveBeenCalledTimes(1);
            expect(upsertPending.mock.calls[0][1].match).toBeNull();
        });
    });
});
