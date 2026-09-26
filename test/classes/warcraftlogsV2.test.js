jest.mock("axios", () => require("../helpers/axiosMock").mockAxios());
jest.mock("../../src/utils/httpAgent", () => ({ fake: "agent" }));

const { transport, reply, fail, timeout, respond, sent } = require("../helpers/axiosMock");
const WarcraftLogsV2 = require("../../src/classes/warcraftlogsV2.js");

function configured() {
    return new WarcraftLogsV2({ clientId: "id", clientSecret: "secret" });
}

function tokenReply(expiresIn = 3600, token = "tok") {
    return reply(200, { access_token: token, token_type: "Bearer", expires_in: expiresIn });
}

function dataReply(data, extra = {}) {
    return reply(200, { data, ...extra });
}

const body = (n) => JSON.parse(sent(n).data);

describe("classes/WarcraftLogsV2", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        transport.mockReset();
        jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    describe("configuration", () => {
        it("is not configured without both id and secret, and trims them", () => {
            expect(new WarcraftLogsV2().isConfigured()).toBe(false);
            expect(new WarcraftLogsV2({ clientId: "a" }).isConfigured()).toBe(false);
            expect(new WarcraftLogsV2({ clientId: " ", clientSecret: "b" }).isConfigured()).toBe(false);
            const c = new WarcraftLogsV2({ clientId: " a ", clientSecret: " b " });
            expect(c.isConfigured()).toBe(true);
            expect(c.clientId).toBe("a");
        });

        it("targets the www token and client endpoints (the v2 API is game-wide)", () => {
            const c = configured();
            expect(c.tokenUrl).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(c.apiUrl).toBe("https://www.warcraftlogs.com/api/v2/client");
        });
    });

    describe("query", () => {
        it("answers null without credentials and makes no request", async () => {
            const c = new WarcraftLogsV2();
            expect(await c.query("{ x }")).toBeNull();
            expect(c.lastError).toEqual({ reason: "not_configured" });
            expect(transport).not.toHaveBeenCalled();
        });

        it("fetches a client-credentials token, then posts the query with it", async () => {
            respond(tokenReply(), dataReply({ reportData: { report: { code: "abc" } } }));
            const c = configured();
            const data = await c.query("query Q($code: String!) { reportData { report(code: $code) { code } } }", { code: "abc" });

            expect(sent(0).url).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(sent(0).method).toBe("post");
            expect(sent(0).data).toBe("grant_type=client_credentials");
            expect(sent(0).auth).toEqual({ username: "id", password: "secret" });
            expect(sent(0).timeout).toBe(10000);

            expect(sent(1).url).toBe("https://www.warcraftlogs.com/api/v2/client");
            expect(body(1)).toEqual({ query: expect.stringContaining("reportData"), variables: { code: "abc" } });
            expect(sent(1).headers.Authorization).toBe("Bearer tok");
            expect(sent(1).timeout).toBe(30000);
            expect(sent(1).httpsAgent).toEqual({ fake: "agent" });
            expect(data).toEqual({ reportData: { report: { code: "abc" } } });
            expect(c.lastError).toBeNull();
        });

        it("reuses the token while it is valid and refreshes it once it is about to expire", async () => {
            let now = 1_000_000;
            jest.spyOn(Date, "now").mockImplementation(() => now);
            respond(tokenReply(3600, "first"), dataReply({}), dataReply({}), tokenReply(3600, "second"), dataReply({}));
            const c = configured();
            await c.query("{ a }");
            await c.query("{ b }");
            expect(transport).toHaveBeenCalledTimes(3); // one token, two queries
            expect(sent(2).headers.Authorization).toBe("Bearer first");

            // a minute before the hour is up the token counts as expired
            now += (3600 - 60) * 1000;
            await c.query("{ c }");
            expect(transport).toHaveBeenCalledTimes(5);
            expect(sent(3).url).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(sent(4).headers.Authorization).toBe("Bearer second");
        });

        it("answers null and records the status when the token request fails", async () => {
            respond(reply(401, { error: "invalid_client" }));
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toEqual({ status: 401, message: "ERR_BAD_REQUEST" });
            expect(transport).toHaveBeenCalledTimes(1);
        });

        // A token WCL no longer honours (revoked, or expired before expires_in
        // said) is dropped and the query repeated once with a fresh one.
        it("on a 401 from the query drops the cached token and retries exactly once", async () => {
            respond(
                tokenReply(3600, "stale"),
                reply(401, "Unauthorized"),
                tokenReply(3600, "fresh"),
                dataReply({ reportData: { report: { code: "abc" } } })
            );
            const c = configured();
            expect(await c.query("{ a }")).toEqual({ reportData: { report: { code: "abc" } } });
            expect(transport).toHaveBeenCalledTimes(4);
            expect(sent(1).headers.Authorization).toBe("Bearer stale");
            expect(sent(2).url).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(sent(3).headers.Authorization).toBe("Bearer fresh");
            expect(c.lastError).toBeNull();
        });

        it("gives up after the one retry when the query is refused again", async () => {
            respond(tokenReply(3600, "one"), reply(401, "no"), tokenReply(3600, "two"), reply(401, "no"));
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ status: 401 });
            expect(transport).toHaveBeenCalledTimes(4);
            // and the next query does not keep the refused token
            respond(tokenReply(3600, "three"), dataReply({}));
            await c.query("{ b }");
            expect(transport).toHaveBeenCalledTimes(6);
            expect(sent(5).headers.Authorization).toBe("Bearer three");
        });

        it("repeats a query that met a 5xx or a dropped connection (it is a read)", async () => {
            respond(tokenReply(), reply(502, "Bad Gateway"), fail(), dataReply({ ok: 1 }));
            const c = configured();
            expect(await c.query("{ a }")).toEqual({ ok: 1 });
            expect(transport).toHaveBeenCalledTimes(4);
            expect(body(3)).toEqual(body(1));
        }, 10000);

        it("records the last failure after the retries are spent", async () => {
            respond(tokenReply(), reply(500, "a"), reply(500, "b"), reply(500, "c"));
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toEqual({ status: 500, message: "ERR_BAD_RESPONSE" });
            expect(transport).toHaveBeenCalledTimes(4);
        }, 10000);

        it("does not repeat a 4xx other than 401, nor a timeout", async () => {
            respond(tokenReply(), reply(400, "bad query"));
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ status: 400 });
            expect(transport).toHaveBeenCalledTimes(2);

            respond(timeout());
            expect(await c.query("{ b }")).toBeNull();
            expect(c.lastError).toEqual({ status: null, message: "ECONNABORTED" });
            expect(transport).toHaveBeenCalledTimes(3);
        });

        it("answers null when the token response carries no access_token", async () => {
            respond(reply(200, {}));
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ status: null, message: expect.stringContaining("access_token") });
        });

        it("keeps the partial data but records GraphQL errors", async () => {
            respond(tokenReply(), dataReply({ reportData: null }, { errors: [{ message: "Unknown fight" }, { message: "Rate limited" }] }));
            const c = configured();
            expect(await c.query("{ a }")).toEqual({ reportData: null });
            expect(c.lastError).toEqual({ reason: "graphql", message: "Unknown fight; Rate limited" });
        });

        it("answers null for GraphQL errors without data", async () => {
            respond(tokenReply(), reply(200, { errors: [{ message: "boom" }] }));
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toEqual({ reason: "graphql", message: "boom" });
        });
    });

    describe("getFightSeries", () => {
        const graph = { data: { series: [{ name: "Total", pointStart: 100, pointInterval: 1000, total: 10, data: [1, 2] }] } };

        it("asks for both graphs and the enemy events of the fight window in one request", async () => {
            respond(tokenReply(), dataReply({ reportData: { report: {
                damage: graph, healing: null,
                enemyEvents: { data: [{ timestamp: 100, type: "damage" }], nextPageTimestamp: null },
            } } }));
            const c = configured();
            const out = await c.getFightSeries("abc", 3, 100, 5000);
            const q = body(1);
            expect(q.variables).toEqual({ code: "abc", id: 3, start: 100, end: 5000 });
            expect(q.query).toContain("dataType: DamageDone, hostilityType: Friendlies");
            expect(q.query).toContain("dataType: Healing, hostilityType: Friendlies");
            expect(q.query).toContain("hostilityType: Enemies, includeResources: true");
            expect(out).toEqual({ damage: graph, healing: null, enemyEvents: [{ timestamp: 100, type: "damage" }] });
        });

        it("follows nextPageTimestamp for the enemy events until the fight's end", async () => {
            respond(
                tokenReply(),
                dataReply({ reportData: { report: {
                    damage: null, healing: null,
                    enemyEvents: { data: [{ timestamp: 100 }], nextPageTimestamp: 2000 },
                } } }),
                dataReply({ reportData: { report: {
                    enemyEvents: { data: [{ timestamp: 2000 }, { timestamp: 4000 }], nextPageTimestamp: 5000 },
                } } })
            );
            const c = configured();
            const out = await c.getFightSeries("abc", 3, 100, 5000);
            expect(transport).toHaveBeenCalledTimes(3);
            expect(body(2).variables).toEqual({ code: "abc", id: 3, start: 2000, end: 5000 });
            expect(out.enemyEvents.map((e) => e.timestamp)).toEqual([100, 2000, 4000]);
        });

        it("answers null when unconfigured or when the report is missing", async () => {
            expect(await new WarcraftLogsV2().getFightSeries("abc", 1, 0, 1)).toBeNull();
            respond(tokenReply(), dataReply({ reportData: { report: null } }));
            expect(await configured().getFightSeries("abc", 1, 0, 1)).toBeNull();
        });
    });
});
