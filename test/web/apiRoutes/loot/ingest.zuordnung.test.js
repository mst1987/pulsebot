// #1002: an upload that names its game version is matched by its recipients
// against the raids of the key's servers; without one it stays as before.
const { mockRes, status, json, jsonRequest } = require("../../../helpers/http");

// No session user anywhere in this file: the uploader is a machine.
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../../src/stores/loot/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: jest.requireActual("../../../../src/stores/loot/ingestTokenStore").bearerFrom,
}));
jest.mock("../../../../src/stores/loot/lootInboxStore", () => ({
    upsertPending: jest.fn(() => ({ entry: { id: "inbox1", itemCount: 1 }, added: 1, created: true })),
    resolutionFor: jest.fn(() => null),
    listPending: jest.fn(() => []),
    getPending: jest.fn(),
    resolvePending: jest.fn(),
    noteAppended: jest.fn(() => true),
    listLinked: jest.fn(() => []),
}));
jest.mock("../../../../src/stores/loot/lootStore", () => ({
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
jest.mock("../../../../src/services/characters/characterInfo", () => ({
    rememberFromLoot: jest.fn(),
    annotatedCharacters: jest.fn(() => []),
    resolveMissing: jest.fn(),
}));
jest.mock("../../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
    eventLookbackSince: jest.fn(() => 0),
    EVENT_LOOKBACK_DAYS: 30,
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
// Two configured servers: the upload has no session, so the match searches both (#919).
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({
    ...jest.requireActual("../../../../src/services/discord/roles/guildRoles"),
    serverIds: jest.fn(() => ["gA", "gB"]),
}));
// A personal key's servers (#1000) come from its owner's orga roles - set per test, never Discord.
jest.mock("../../../../src/services/discord/servers/ingestServers", () => {
    const actual = jest.requireActual("../../../../src/services/discord/servers/ingestServers");
    return { ...actual, serversOfToken: jest.fn(actual.serversOfToken) };
});
// Import-time item enrichment must never hit the network.
jest.mock("../../../../src/utils/loot/wowhead", () => ({
    lookupItem: jest.fn(async () => null),
    searchItems: jest.fn(async () => []),
}));
jest.mock("../../../../src/services/versions/mainVersion", () => ({
    ...jest.requireActual("../../../../src/services/versions/mainVersion"),
    versionOfEvent: (e) => e.versionId || "tbc",
}));
jest.mock("../../../../src/services/versions/versionSettings", () => ({
    ...jest.requireActual("../../../../src/services/versions/versionSettings"),
    settingsForVersion: () => ({ blizzardRealmSlug: "thunderstrike" }),
}));

const { verifyToken } = require("../../../../src/stores/loot/ingestTokenStore");
const { upsertPending, resolutionFor, listPending } = require("../../../../src/stores/loot/lootInboxStore");
const { loadEventGroups } = require("../../../../src/services/events/raidEventGroups");
const { serversOfToken } = require("../../../../src/services/discord/servers/ingestServers");
const { handle } = require("../../../../src/web/http/apiRouter");
const { EH_FORMAT, EH_VERSION } = require("../../../../src/utils/loot/lootImport");

const PERSON = { id: "p1", name: "Laptop", ownerId: "u1", guildId: "" };
const START = 1784574000;
const PEOPLE = ["Keslight", "Gemli", "Arthas", "Jaina", "Thrall"];

const payload = (over = {}) => ({
    format: EH_FORMAT,
    version: EH_VERSION,
    realm: "Thunderstrike",
    reporter: "Gemli-Thunderstrike",
    gameVersion: "tbc",
    client: { addon: "1.0.0", sync: "1.0.0" },
    sessions: [{
        sessionId: "eh-1784574000-ssc",
        startedAt: START,
        endedAt: START + 7200,
        instance: "Serpentshrine Cavern",
        items: PEOPLE.map((p, i) => ({
            source: "gargul", rawId: `sum${i}`, itemId: 30242 + i, player: p,
            class: "paladin", response: "Main Spec", offspec: false, awardedAt: START + 60 * i,
        })),
    }],
    ...over,
});

const raid = (id, names, over = {}) => ({
    id, title: `Raid ${id}`, startTime: START, signUps: names.map((n) => ({ userId: `u-${n}`, character: n })), ...over,
});
// The raids of each server, as the event groups of that server.
function raidsOn(byServer) {
    loadEventGroups.mockImplementation(async (guildId) => ({
        groups: [{ categoryId: `cat-${guildId}`, categoryName: `Kat ${guildId}`, events: byServer[guildId] || [] }],
    }));
}

async function upload(jsonBody) {
    const req = jsonRequest("POST", "/api/ingest/loot", jsonBody, { authorization: "Bearer ehl_good" });
    const res = mockRes();
    await handle("/api/ingest/loot", req, res);
    return res;
}
const placed = () => upsertPending.mock.calls[0][1];

beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue(PERSON);
    resolutionFor.mockReturnValue(null);
    upsertPending.mockImplementation((s, meta) => ({ entry: { id: "inbox1", itemCount: 5, waiting: !!meta.waiting }, added: 5, created: true }));
    serversOfToken.mockResolvedValue(["gA", "gC"]);
});

describe("POST /api/ingest/loot with a game version (#1002)", () => {
    it("files the upload under the one raid where 60 % signed up", async () => {
        raidsOn({ gA: [raid("eA", PEOPLE.slice(0, 4))], gC: [raid("eC", ["Keslight"])] });
        const res = await upload(payload());
        expect(status(res)).toBe(201);
        expect(placed()).toMatchObject({ guildId: "gA", gameVersion: "tbc", waiting: false, servers: [] });
        expect(placed().match.suggested).toMatchObject({ eventId: "eA", matched: 4, total: 5 });
        expect(json(res).data.results[0]).toMatchObject({ status: "pending", suggested: "Raid eA" });
        expect(json(res).data.results[0].waiting).toBeUndefined();
    });

    it("waits for both servers when two raids pass 60 %", async () => {
        raidsOn({ gA: [raid("eA", PEOPLE)], gC: [raid("eC", PEOPLE.slice(0, 3))] });
        const res = await upload(payload());
        expect(placed()).toMatchObject({ guildId: "", waiting: true, servers: ["gA", "gC"] });
        expect(placed().match).toMatchObject({ ambiguous: true, suggested: null, best: "eA" });
        expect(json(res).data.results[0]).toMatchObject({ status: "pending", waiting: true, suggested: "" });
    });

    it("waits on the key's servers when no raid fits", async () => {
        raidsOn({ gA: [raid("eA", PEOPLE, { versionId: "forever" })], gC: [] });
        await upload(payload());
        expect(placed()).toMatchObject({ waiting: true, servers: ["gA", "gC"] });
        expect(placed().match.candidates).toEqual([]);
    });

    it("never looks at raids of a server outside the key's", async () => {
        raidsOn({ gA: [], gB: [raid("eB", PEOPLE)], gC: [] });
        await upload(payload());
        expect(loadEventGroups.mock.calls.map((c) => c[0]).sort()).toEqual(["gA", "gC"]);
        expect(placed().match.candidates).toEqual([]);
        expect(placed().servers).not.toContain("gB");
    });

    it("still keeps the upload, waiting, when the raid lookup fails", async () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        loadEventGroups.mockRejectedValue(new Error("down"));
        const res = await upload(payload());
        expect(status(res)).toBe(201);
        expect(placed()).toMatchObject({ waiting: true, servers: ["gA", "gC"] });
        spy.mockRestore();
    });

    it("leaves a card waiting for other servers alone (#994)", async () => {
        listPending.mockReturnValue([{
            id: "inbox1", sessionId: "eh-1784574000-ssc", guildId: "", waiting: true, servers: ["gA", "gB"], match: { suggested: null },
        }]);
        serversOfToken.mockResolvedValue(["gC"]);
        raidsOn({ gC: [raid("eC", PEOPLE)] });
        const res = await upload(payload());
        expect(json(res).data.results[0]).toMatchObject({ status: "other_server", added: 0 });
        expect(upsertPending).not.toHaveBeenCalled();
        // a key sharing one of its servers may still add to it
        serversOfToken.mockResolvedValue(["gB", "gC"]);
        await upload(payload());
        expect(upsertPending).toHaveBeenCalledTimes(1);
        listPending.mockReturnValue([]);
    });

    it("keeps the plain day match without a game version", async () => {
        raidsOn({ gA: [raid("eA", [])], gC: [] });
        const body = payload();
        delete body.gameVersion;
        await upload(body);
        const meta = placed();
        expect(meta.guildId).toBe("gA");
        expect(meta.waiting).toBeUndefined();
        expect(meta.gameVersion).toBeUndefined();
        expect(meta.match.suggested).toMatchObject({ eventId: "eA", guildId: "gA" });
    });
});
