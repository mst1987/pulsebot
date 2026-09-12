jest.mock("axios");
jest.mock("../../src/utils/httpAgent");

const axios = require("axios");
const WarcraftLogsV2 = require("../../src/classes/warcraftlogsV2.js");

function configured() {
    return new WarcraftLogsV2({ clientId: "id", clientSecret: "secret" });
}

function tokenResponse(expiresIn = 3600, token = "tok") {
    return { data: { access_token: token, token_type: "Bearer", expires_in: expiresIn } };
}

describe("classes/WarcraftLogsV2", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        // clearAllMocks keeps queued mockResolvedValueOnce values; a test that
        // queues more than it consumes must not feed the next one
        axios.post.mockReset();
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
            expect(axios.post).not.toHaveBeenCalled();
        });

        it("fetches a client-credentials token, then posts the query with it", async () => {
            axios.post
                .mockResolvedValueOnce(tokenResponse())
                .mockResolvedValueOnce({ data: { data: { reportData: { report: { code: "abc" } } } } });
            const c = configured();
            const data = await c.query("query Q($code: String!) { reportData { report(code: $code) { code } } }", { code: "abc" });

            expect(axios.post.mock.calls[0][0]).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(axios.post.mock.calls[0][1]).toBe("grant_type=client_credentials");
            expect(axios.post.mock.calls[0][2]).toEqual(expect.objectContaining({ auth: { username: "id", password: "secret" } }));

            const [url, body, cfg] = axios.post.mock.calls[1];
            expect(url).toBe("https://www.warcraftlogs.com/api/v2/client");
            expect(body).toEqual({ query: expect.stringContaining("reportData"), variables: { code: "abc" } });
            expect(cfg.headers.Authorization).toBe("Bearer tok");
            expect(data).toEqual({ reportData: { report: { code: "abc" } } });
            expect(c.lastError).toBeNull();
        });

        it("reuses the token while it is valid and refreshes it once it is about to expire", async () => {
            let now = 1_000_000;
            jest.spyOn(Date, "now").mockImplementation(() => now);
            axios.post
                .mockResolvedValueOnce(tokenResponse(3600, "first"))
                .mockResolvedValueOnce({ data: { data: {} } })
                .mockResolvedValueOnce({ data: { data: {} } })
                .mockResolvedValueOnce(tokenResponse(3600, "second"))
                .mockResolvedValueOnce({ data: { data: {} } });
            const c = configured();
            await c.query("{ a }");
            await c.query("{ b }");
            expect(axios.post).toHaveBeenCalledTimes(3); // one token, two queries
            expect(axios.post.mock.calls[2][2].headers.Authorization).toBe("Bearer first");

            // a minute before the hour is up the token counts as expired
            now += (3600 - 60) * 1000;
            await c.query("{ c }");
            expect(axios.post).toHaveBeenCalledTimes(5);
            expect(axios.post.mock.calls[3][0]).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(axios.post.mock.calls[4][2].headers.Authorization).toBe("Bearer second");
        });

        it("answers null and records the status when the token request fails", async () => {
            axios.post.mockRejectedValueOnce({ response: { status: 401 }, message: "Unauthorized" });
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ status: 401 });
            expect(axios.post).toHaveBeenCalledTimes(1);
        });

        // A token WCL no longer honours (revoked, or expired before expires_in
        // said) is dropped and the query repeated once with a fresh one.
        it("on a 401 from the query drops the cached token and retries exactly once", async () => {
            jest.spyOn(console, "warn").mockImplementation(() => {});
            axios.post
                .mockResolvedValueOnce(tokenResponse(3600, "stale"))
                .mockRejectedValueOnce({ response: { status: 401 }, message: "Unauthorized" })
                .mockResolvedValueOnce(tokenResponse(3600, "fresh"))
                .mockResolvedValueOnce({ data: { data: { reportData: { report: { code: "abc" } } } } });
            const c = configured();
            expect(await c.query("{ a }")).toEqual({ reportData: { report: { code: "abc" } } });
            expect(axios.post).toHaveBeenCalledTimes(4);
            expect(axios.post.mock.calls[1][2].headers.Authorization).toBe("Bearer stale");
            expect(axios.post.mock.calls[2][0]).toBe("https://www.warcraftlogs.com/oauth/token");
            expect(axios.post.mock.calls[3][2].headers.Authorization).toBe("Bearer fresh");
            expect(c.lastError).toBeNull();
        });

        it("gives up after the one retry when the query is refused again", async () => {
            jest.spyOn(console, "warn").mockImplementation(() => {});
            axios.post
                .mockResolvedValueOnce(tokenResponse(3600, "one"))
                .mockRejectedValueOnce({ response: { status: 401 }, message: "Unauthorized" })
                .mockResolvedValueOnce(tokenResponse(3600, "two"))
                .mockRejectedValueOnce({ response: { status: 401 }, message: "Unauthorized" });
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ status: 401 });
            expect(axios.post).toHaveBeenCalledTimes(4);
            // and the next query does not keep the refused token
            axios.post.mockResolvedValueOnce(tokenResponse(3600, "three")).mockResolvedValueOnce({ data: { data: {} } });
            await c.query("{ b }");
            expect(axios.post).toHaveBeenCalledTimes(6);
            expect(axios.post.mock.calls[5][2].headers.Authorization).toBe("Bearer three");
        });

        it("does not retry any other failure of the query", async () => {
            jest.spyOn(console, "warn").mockImplementation(() => {});
            axios.post
                .mockResolvedValueOnce(tokenResponse())
                .mockRejectedValueOnce({ response: { status: 500 }, message: "Server Error" });
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ status: 500 });
            expect(axios.post).toHaveBeenCalledTimes(2);
        });

        it("answers null when the token response carries no access_token", async () => {
            axios.post.mockResolvedValueOnce({ data: {} });
            const c = configured();
            expect(await c.query("{ a }")).toBeNull();
            expect(c.lastError).toMatchObject({ message: expect.stringContaining("access_token") });
        });

        it("keeps the partial data but records GraphQL errors", async () => {
            axios.post
                .mockResolvedValueOnce(tokenResponse())
                .mockResolvedValueOnce({ data: { data: { reportData: null }, errors: [{ message: "Unknown fight" }, { message: "Rate limited" }] } });
            const c = configured();
            expect(await c.query("{ a }")).toEqual({ reportData: null });
            expect(c.lastError).toEqual({ reason: "graphql", message: "Unknown fight; Rate limited" });
        });
    });

    describe("getFightSeries", () => {
        const graph = { data: { series: [{ name: "Total", pointStart: 100, pointInterval: 1000, total: 10, data: [1, 2] }] } };

        it("asks for both graphs and the enemy events of the fight window in one request", async () => {
            axios.post
                .mockResolvedValueOnce(tokenResponse())
                .mockResolvedValueOnce({ data: { data: { reportData: { report: {
                    damage: graph, healing: null,
                    enemyEvents: { data: [{ timestamp: 100, type: "damage" }], nextPageTimestamp: null },
                } } } } });
            const c = configured();
            const out = await c.getFightSeries("abc", 3, 100, 5000);
            const body = axios.post.mock.calls[1][1];
            expect(body.variables).toEqual({ code: "abc", id: 3, start: 100, end: 5000 });
            expect(body.query).toContain("dataType: DamageDone, hostilityType: Friendlies");
            expect(body.query).toContain("dataType: Healing, hostilityType: Friendlies");
            expect(body.query).toContain("hostilityType: Enemies, includeResources: true");
            expect(out).toEqual({ damage: graph, healing: null, enemyEvents: [{ timestamp: 100, type: "damage" }] });
        });

        it("follows nextPageTimestamp for the enemy events until the fight's end", async () => {
            axios.post
                .mockResolvedValueOnce(tokenResponse())
                .mockResolvedValueOnce({ data: { data: { reportData: { report: {
                    damage: null, healing: null,
                    enemyEvents: { data: [{ timestamp: 100 }], nextPageTimestamp: 2000 },
                } } } } })
                .mockResolvedValueOnce({ data: { data: { reportData: { report: {
                    enemyEvents: { data: [{ timestamp: 2000 }, { timestamp: 4000 }], nextPageTimestamp: 5000 },
                } } } } });
            const c = configured();
            const out = await c.getFightSeries("abc", 3, 100, 5000);
            expect(axios.post).toHaveBeenCalledTimes(3);
            expect(axios.post.mock.calls[2][1].variables).toEqual({ code: "abc", id: 3, start: 2000, end: 5000 });
            expect(out.enemyEvents.map((e) => e.timestamp)).toEqual([100, 2000, 4000]);
        });

        it("answers null when unconfigured or when the report is missing", async () => {
            expect(await new WarcraftLogsV2().getFightSeries("abc", 1, 0, 1)).toBeNull();
            axios.post
                .mockResolvedValueOnce(tokenResponse())
                .mockResolvedValueOnce({ data: { data: { reportData: { report: null } } } });
            expect(await configured().getFightSeries("abc", 1, 0, 1)).toBeNull();
        });
    });
});
