// GET/POST /api/ingest/guildbank/handouts through the real router: the token
// gate, the bank filter and the report's refusals. The list and the report
// themselves are services/guildbank/handouts.js (tested there).
const { mockRes, status, json, jsonRequest, routerClient } = require("../../../helpers/http");

// The sync tool is a machine: no session anywhere.
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: jest.requireActual("../../../../src/stores/ingestTokenStore").bearerFrom,
}));
jest.mock("../../../../src/services/guildbank/handouts", () => {
    const actual = jest.requireActual("../../../../src/services/guildbank/handouts");
    return { ...actual, handoutList: jest.fn(), reportHandouts: jest.fn() };
});

// A personal key's servers (#1000) come from its owner's orga roles - set per test, never Discord.
jest.mock("../../../../src/services/discord/servers/ingestServers", () => {
    const actual = jest.requireActual("../../../../src/services/discord/servers/ingestServers");
    return { ...actual, serversOfToken: jest.fn(actual.serversOfToken) };
});

const { verifyToken, touchToken } = require("../../../../src/stores/ingestTokenStore");
const { serversOfToken } = require("../../../../src/services/discord/servers/ingestServers");
const handouts = require("../../../../src/services/guildbank/handouts");
const ingest = require("../../../../src/web/apiRoutes/loot/ingest");

const PATH = "/api/ingest/guildbank/handouts";
const TOKEN = { id: "t1", name: "Raidlead-PC" };
const { handle, urlFor } = routerClient(ingest);

async function get(query, authorization = "Bearer ehl_good") {
    const res = mockRes();
    await handle(PATH, { method: "GET", headers: authorization ? { authorization } : {} }, res, urlFor(PATH, query));
    return res;
}

async function post(payload, authorization = "Bearer ehl_good") {
    const req = jsonRequest("POST", PATH, payload, authorization ? { authorization } : {});
    const res = mockRes();
    await handle(PATH, req, res);
    return res;
}

const LIST = { format: "eventhelper-guildbank-handouts", version: 1, generatedAt: 1791100000, banks: [] };
const REPORT = { format: "eventhelper-guildbank-handouts", version: 1, ok: ["r1"], duplicate: [], notConfirmed: [], unknown: [], invalid: 0 };

beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue(TOKEN);
    handouts.handoutList.mockReturnValue(LIST);
    handouts.reportHandouts.mockResolvedValue(REPORT);
});

describe("GET /api/ingest/guildbank/handouts", () => {
    it("refuses a request without a token, and with an unknown one", async () => {
        let res = await get(undefined, null);
        expect(status(res)).toBe(401);
        expect(json(res).error.code).toBe("no_token");
        verifyToken.mockReturnValue(null);
        res = await get();
        expect(status(res)).toBe(401);
        expect(json(res).error.code).toBe("bad_token");
        expect(handouts.handoutList).not.toHaveBeenCalled();
        expect(touchToken).not.toHaveBeenCalled();
    });

    it("answers a valid token with the list and records the use", async () => {
        const res = await get();
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual(LIST);
        expect(handouts.handoutList).toHaveBeenCalledWith({ token: TOKEN, servers: null, bankKey: "" });
        expect(touchToken).toHaveBeenCalledWith("t1");
    });

    // #994: the service scopes list and report to the key's server (handouts.test.js).
    it("hands a server key on to the list and the report", async () => {
        const own = { ...TOKEN, guildId: "g2" };
        verifyToken.mockReturnValue(own);
        await get();
        expect(handouts.handoutList).toHaveBeenCalledWith({ token: own, servers: ["g2"], bankKey: "" });
        await post({ done: ["r1"] });
        expect(handouts.reportHandouts).toHaveBeenCalledWith({ done: ["r1"] }, { token: own, servers: ["g2"] });
    });

    // #1000: a personal key hands on its owner's orga servers, never more.
    it("hands a personal key's servers on to the list and the report", async () => {
        const person = { id: "p1", name: "Laptop", ownerId: "u1", guildId: "" };
        verifyToken.mockReturnValue(person);
        serversOfToken.mockResolvedValueOnce(["gA"]).mockResolvedValueOnce(["gA"]);
        await get();
        expect(handouts.handoutList).toHaveBeenCalledWith({ token: person, servers: ["gA"], bankKey: "" });
        await post({ done: ["r1"] });
        expect(handouts.reportHandouts).toHaveBeenCalledWith({ done: ["r1"] }, { token: person, servers: ["gA"] });
    });

    it("refuses a personal key whose owner is orga nowhere with 403 no_server", async () => {
        verifyToken.mockReturnValue({ id: "p1", name: "Laptop", ownerId: "u1", guildId: "" });
        serversOfToken.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        const res = await get();
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("no_server");
        expect(status(await post({ done: ["r1"] }))).toBe(403);
        expect(handouts.handoutList).not.toHaveBeenCalled();
        expect(handouts.reportHandouts).not.toHaveBeenCalled();
    });

    it("passes the bank filter through", async () => {
        await get({ bank: "tbc:spineshatter:die gilde" });
        expect(handouts.handoutList).toHaveBeenCalledWith({ token: TOKEN, servers: null, bankKey: "tbc:spineshatter:die gilde" });
    });
});

describe("POST /api/ingest/guildbank/handouts", () => {
    it("refuses a report without a token", async () => {
        const res = await post({ done: ["r1"] }, null);
        expect(status(res)).toBe(401);
        expect(handouts.reportHandouts).not.toHaveBeenCalled();
    });

    it("hands the report to the service and answers its per-id results", async () => {
        const res = await post({ done: ["r1"] });
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual(REPORT);
        expect(handouts.reportHandouts).toHaveBeenCalledWith({ done: ["r1"] }, { token: TOKEN, servers: null });
        expect(touchToken).toHaveBeenCalledWith("t1");
    });

    it("answers a body that is no report with 400 and records nothing", async () => {
        handouts.reportHandouts.mockRejectedValue(new handouts.HandoutReportError("`done` fehlt oder ist keine Liste."));
        const res = await post({ nope: 1 });
        expect(status(res)).toBe(400);
        expect(json(res).error).toEqual({ code: "parse_failed", message: "`done` fehlt oder ist keine Liste." });
        expect(touchToken).not.toHaveBeenCalled();
    });

    it("leaves any other failure to the router's 500", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        handouts.reportHandouts.mockRejectedValue(new Error("disk full"));
        const res = await post({ done: ["r1"] });
        expect(status(res)).toBe(500);
        console.error.mockRestore();
    });
});
