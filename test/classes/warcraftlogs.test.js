jest.mock("axios", () => require("../helpers/axiosMock").mockAxios());
jest.mock("../../src/utils/httpAgent", () => ({ fake: "agent" }));

const axios = require("axios");
const agent = require("../../src/utils/httpAgent");
const { transport, reply, respond, sent } = require("../helpers/axiosMock");
const { ApiError } = require("../../src/classes/httpClient");
const WarcraftLogs = require("../../src/classes/warcraftlogs.js");

const url = (cfg) => (/^https?:/.test(cfg.url) ? cfg.url : `${cfg.baseURL}${cfg.url}`);

describe("classes/WarcraftLogs", () => {
    const OLD_ENV = process.env.WARCRAFTLOGS_API_KEY;

    beforeEach(() => {
        transport.mockReset();
        process.env.WARCRAFTLOGS_API_KEY = "test-wcl-key";
    });

    afterEach(() => {
        if (OLD_ENV === undefined) {
            delete process.env.WARCRAFTLOGS_API_KEY;
        } else {
            process.env.WARCRAFTLOGS_API_KEY = OLD_ENV;
        }
    });

    describe("constructor", () => {
        it("reads the api key from the environment and targets the classic v1 host", () => {
            const client = new WarcraftLogs();
            expect(client.apiKey).toBe("test-wcl-key");
            expect(client.baseUrl).toBe("https://classic.warcraftlogs.com/v1/");
        });

        it("accepts an explicit api key argument", () => {
            const client = new WarcraftLogs("explicit-key");
            expect(client.apiKey).toBe("explicit-key");
        });

        it("throws when no api key is available", () => {
            delete process.env.WARCRAFTLOGS_API_KEY;
            expect(() => new WarcraftLogs()).toThrow(
                "WARCRAFTLOGS_API_KEY is not set in the environment."
            );
        });
    });

    describe("parseReportId", () => {
        it("returns the id unchanged when given a bare id", () => {
            expect(WarcraftLogs.parseReportId("aBcD1234")).toBe("aBcD1234");
        });

        it("extracts the id from a full report url", () => {
            expect(
                WarcraftLogs.parseReportId(
                    "https://classic.warcraftlogs.com/reports/aBcD1234"
                )
            ).toBe("aBcD1234");
        });

        it("strips query string, fragment and trailing path", () => {
            expect(
                WarcraftLogs.parseReportId(
                    "https://classic.warcraftlogs.com/reports/aBcD1234#fight=3&type=damage-done"
                )
            ).toBe("aBcD1234");
            expect(
                WarcraftLogs.parseReportId(
                    "https://classic.warcraftlogs.com/reports/aBcD1234?fight=last"
                )
            ).toBe("aBcD1234");
        });

        it("rewrites the .cn host to .com before parsing", () => {
            expect(
                WarcraftLogs.parseReportId(
                    "https://cn.warcraftlogs.cn/reports/xyz789"
                )
            ).toBe("xyz789");
        });

        it("returns an empty string for falsy input", () => {
            expect(WarcraftLogs.parseReportId("")).toBe("");
            expect(WarcraftLogs.parseReportId(null)).toBe("");
        });
    });

    describe("getFights", () => {
        it("GETs report/fights with translate + api_key params, the shared agent and a timeout", async () => {
            const client = new WarcraftLogs();
            respond(reply(200, { fights: [] }));

            const result = await client.getFights("rep1");

            const req = sent();
            expect(url(req)).toBe("https://classic.warcraftlogs.com/v1/report/fights/rep1");
            expect(req.params).toEqual({ translate: true, api_key: "test-wcl-key" });
            expect(req.httpsAgent).toEqual(agent);
            expect(req.timeout).toBe(WarcraftLogs.REQUEST_TIMEOUT_MS);
            expect(result).toEqual({ fights: [] });
        });

        it("throws an ApiError that still carries axios' response status", async () => {
            const client = new WarcraftLogs();
            respond(reply(401, { error: "Invalid key" }));

            const err = await client.getFights("rep1").catch((e) => e);

            expect(err).toBeInstanceOf(ApiError);
            expect(err).toMatchObject({ service: "Warcraft Logs", status: 401, kind: "http" });
            // utils/logcheck/report.js prints this one
            expect(err.response.status).toBe(401);
            expect(transport).toHaveBeenCalledTimes(1);
        });

        it("retries a 5xx before answering", async () => {
            const client = new WarcraftLogs();
            respond(reply(503, "busy"), reply(200, { fights: [1] }));
            await expect(client.getFights("rep1")).resolves.toEqual({ fights: [1] });
            expect(transport).toHaveBeenCalledTimes(2);
        });
    });

    describe("getSummary / getCasts / getBuffs / getDebuffs / tables", () => {
        it("passes start/end and merges extra params", async () => {
            const client = new WarcraftLogs();
            respond(reply(200, {}));

            await client.getSummary("rep1", 100, 200, { sourceid: 5 });

            const req = sent();
            expect(url(req)).toBe("https://classic.warcraftlogs.com/v1/report/tables/summary/rep1");
            expect(req.params).toEqual({ translate: true, api_key: "test-wcl-key", start: 100, end: 200, sourceid: 5 });
        });

        it.each([
            ["getCasts", "casts"],
            ["getBuffs", "buffs"],
            ["getDebuffs", "debuffs"],
            ["getDamageTaken", "damage-taken"],
            ["getDamageDone", "damage-done"],
            ["getHealing", "healing"],
            ["getDeaths", "deaths"],
            ["getInterrupts", "interrupts"],
        ])("%s builds the %s table path", async (method, table) => {
            const client = new WarcraftLogs();
            respond(reply(200, {}));
            await client[method]("rep1", 1, 2);
            expect(url(sent())).toBe(`https://classic.warcraftlogs.com/v1/report/tables/${table}/rep1`);
            expect(sent().params).toMatchObject({ start: 1, end: 2 });
        });
    });

    describe("getEvents", () => {
        it("builds the events/{view} path with a time window", async () => {
            const client = new WarcraftLogs();
            respond(reply(200, { events: [] }));

            await client.getEvents("rep1", "summary", 10, 20, { hostility: 1 });

            const req = sent();
            expect(url(req)).toBe("https://classic.warcraftlogs.com/v1/report/events/summary/rep1");
            expect(req.params).toEqual({ translate: true, api_key: "test-wcl-key", start: 10, end: 20, hostility: 1 });
        });
    });

    describe("getParses", () => {
        it("targets the fresh host and url-encodes name/realm/region", async () => {
            const client = new WarcraftLogs();
            respond(reply(200, [{ percentile: 99 }]));

            const result = await client.getParses("Naz Gûl", "Thunderstrike", "EU");

            const req = sent();
            expect(axios.getUri(req)).toBe(
                "https://fresh.warcraftlogs.com/v1/parses/character/Naz%20G%C3%BBl/Thunderstrike/EU?metric=dps&api_key=test-wcl-key"
            );
            expect(req.params).toEqual({ metric: "dps", api_key: "test-wcl-key" });
            expect(result).toEqual([{ percentile: 99 }]);
        });

        it("re-throws on failure", async () => {
            const client = new WarcraftLogs();
            respond(reply(404, "no such character"));
            await expect(client.getParses("a", "b", "EU")).rejects.toMatchObject({ status: 404, kind: "http" });
        });
    });

    describe("getAllEvents", () => {
        it("follows nextPageTimestamp and concatenates events", async () => {
            const client = new WarcraftLogs();
            respond(
                reply(200, { events: [{ t: 1 }], nextPageTimestamp: 500 }),
                reply(200, { events: [{ t: 2 }] })
            );

            const result = await client.getAllEvents("rep1", "summary", 0, 1000);

            expect(transport).toHaveBeenCalledTimes(2);
            expect(result).toEqual([{ t: 1 }, { t: 2 }]);
            // second call uses the advanced cursor as start
            expect(sent(1).params.start).toBe(500);
        });

        it("stops when nextPageTimestamp does not advance", async () => {
            const client = new WarcraftLogs();
            transport.mockImplementation(reply(200, { events: [{ t: 1 }], nextPageTimestamp: 0 }));

            const result = await client.getAllEvents("rep1", "summary", 0, 1000);

            expect(transport).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ t: 1 }]);
        });

        it("returns an empty array when a page has no events", async () => {
            const client = new WarcraftLogs();
            transport.mockImplementation(reply(200, {}));

            const result = await client.getAllEvents("rep1", "summary", 0, 1000);

            expect(result).toEqual([]);
        });

        it("stops at maxPages and marks the result as truncated", async () => {
            const client = new WarcraftLogs();
            let t = 0;
            transport.mockImplementation((config) => {
                t += 100;
                return reply(200, { events: [{ t }], nextPageTimestamp: t })(config);
            });

            const result = await client.getAllEvents("rep1", "casts", 0, 100000, {}, { maxPages: 3 });

            expect(transport).toHaveBeenCalledTimes(3);
            expect(result).toHaveLength(3);
            expect(result.truncated).toBe(true);
        });

        it("does not flag a walk that ends within the bound", async () => {
            const client = new WarcraftLogs();
            transport.mockImplementation(reply(200, { events: [{ t: 1 }] }));

            const result = await client.getAllEvents("rep1", "casts", 0, 1000, {}, { maxPages: 3 });

            expect(result.truncated).toBeUndefined();
        });
    });
});
