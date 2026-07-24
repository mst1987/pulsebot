jest.mock("axios");
jest.mock("../../src/utils/httpAgent");

const axios = require("axios");
const agent = require("../../src/utils/httpAgent");
const WarcraftLogs = require("../../src/classes/warcraftlogs.js");

describe("classes/WarcraftLogs", () => {
    const OLD_ENV = process.env.WARCRAFTLOGS_API_KEY;

    beforeEach(() => {
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
        it("GETs report/fights with translate + api_key params", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: { fights: [] } });

            const result = await client.getFights("rep1");

            expect(axios.get).toHaveBeenCalledWith(
                "https://classic.warcraftlogs.com/v1/report/fights/rep1",
                {
                    params: { translate: true, api_key: "test-wcl-key" },
                    httpsAgent: agent,
                }
            );
            expect(result).toEqual({ fights: [] });
        });

        it("re-throws API errors", async () => {
            const client = new WarcraftLogs();
            const err = new Error("Request failed");
            err.response = { status: 401 };
            axios.get.mockRejectedValue(err);

            await expect(client.getFights("rep1")).rejects.toThrow(
                "Request failed"
            );
        });
    });

    describe("getSummary / getCasts / getBuffs / getDebuffs", () => {
        it("passes start/end and merges extra params", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: {} });

            await client.getSummary("rep1", 100, 200, { sourceid: 5 });

            expect(axios.get).toHaveBeenCalledWith(
                "https://classic.warcraftlogs.com/v1/report/tables/summary/rep1",
                {
                    params: {
                        translate: true,
                        api_key: "test-wcl-key",
                        start: 100,
                        end: 200,
                        sourceid: 5,
                    },
                    httpsAgent: agent,
                }
            );
        });

        it("getCasts builds the casts table path", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: {} });
            await client.getCasts("rep1", 1, 2);
            expect(axios.get.mock.calls[0][0]).toBe(
                "https://classic.warcraftlogs.com/v1/report/tables/casts/rep1"
            );
        });

        it("getBuffs builds the buffs table path", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: {} });
            await client.getBuffs("rep1", 1, 2);
            expect(axios.get.mock.calls[0][0]).toBe(
                "https://classic.warcraftlogs.com/v1/report/tables/buffs/rep1"
            );
        });

        it("getDebuffs builds the debuffs table path", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: {} });
            await client.getDebuffs("rep1", 1, 2);
            expect(axios.get.mock.calls[0][0]).toBe(
                "https://classic.warcraftlogs.com/v1/report/tables/debuffs/rep1"
            );
        });
    });

    describe("getEvents", () => {
        it("builds the events/{view} path with a time window", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: { events: [] } });

            await client.getEvents("rep1", "summary", 10, 20, { hostility: 1 });

            expect(axios.get).toHaveBeenCalledWith(
                "https://classic.warcraftlogs.com/v1/report/events/summary/rep1",
                {
                    params: {
                        translate: true,
                        api_key: "test-wcl-key",
                        start: 10,
                        end: 20,
                        hostility: 1,
                    },
                    httpsAgent: agent,
                }
            );
        });
    });

    describe("getParses", () => {
        it("targets the fresh host and url-encodes name/realm/region", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: [{ percentile: 99 }] });

            const result = await client.getParses("Naz Gûl", "Thunderstrike", "EU");

            expect(axios.get).toHaveBeenCalledWith(
                "https://fresh.warcraftlogs.com/v1/parses/character/Naz%20G%C3%BBl/Thunderstrike/EU",
                {
                    params: { metric: "dps", api_key: "test-wcl-key" },
                    httpsAgent: agent,
                }
            );
            expect(result).toEqual([{ percentile: 99 }]);
        });

        it("re-throws on failure", async () => {
            const client = new WarcraftLogs();
            axios.get.mockRejectedValue(new Error("500"));
            await expect(
                client.getParses("a", "b", "EU")
            ).rejects.toThrow("500");
        });
    });

    describe("getAllEvents", () => {
        it("follows nextPageTimestamp and concatenates events", async () => {
            const client = new WarcraftLogs();
            axios.get
                .mockResolvedValueOnce({
                    data: { events: [{ t: 1 }], nextPageTimestamp: 500 },
                })
                .mockResolvedValueOnce({
                    data: { events: [{ t: 2 }] },
                });

            const result = await client.getAllEvents("rep1", "summary", 0, 1000);

            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(result).toEqual([{ t: 1 }, { t: 2 }]);
            // second call uses the advanced cursor as start
            expect(axios.get.mock.calls[1][1].params.start).toBe(500);
        });

        it("stops when nextPageTimestamp does not advance", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({
                data: { events: [{ t: 1 }], nextPageTimestamp: 0 },
            });

            const result = await client.getAllEvents("rep1", "summary", 0, 1000);

            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ t: 1 }]);
        });

        it("returns an empty array when a page has no events", async () => {
            const client = new WarcraftLogs();
            axios.get.mockResolvedValue({ data: {} });

            const result = await client.getAllEvents("rep1", "summary", 0, 1000);

            expect(result).toEqual([]);
        });
    });
});
