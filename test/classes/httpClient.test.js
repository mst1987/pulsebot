jest.mock("axios", () => require("../helpers/axiosMock").mockAxios());
jest.mock("../../src/utils/httpAgent", () => ({ fake: "agent" }));

const axios = require("axios");
const agent = require("../../src/utils/httpAgent");
const { transport, reply, fail, timeout, respond, sent } = require("../helpers/axiosMock");
const { createClient, ApiError, DEFAULT_RETRY } = require("../../src/classes/httpClient");

// delayMs 0 keeps the retry tests instant; the backoff itself has its own test
function client({ retry, ...rest } = {}) {
    return createClient({
        service: "Testdienst",
        baseURL: "https://api.example.test/",
        timeout: 5000,
        retry: retry === false ? false : { delayMs: 0, ...retry },
        ...rest,
    });
}

describe("classes/httpClient", () => {
    beforeEach(() => transport.mockReset());

    describe("createClient", () => {
        it("builds an axios instance with base URL, timeout, headers and the shared https agent", async () => {
            const http = createClient({ service: "X", baseURL: "https://a.test/", timeout: 1234, headers: { "X-Key": "k" } });
            expect(axios.create).toHaveBeenCalledWith({ baseURL: "https://a.test/", timeout: 1234, headers: { "X-Key": "k" }, httpsAgent: agent });
            respond(reply(200, { ok: true }));
            const res = await http.get("things", { params: { a: 1 } });
            expect(res.data).toEqual({ ok: true });
            const cfg = sent();
            expect(cfg.baseURL).toBe("https://a.test/");
            expect(cfg.url).toBe("things");
            expect(cfg.params).toEqual({ a: 1 });
            expect(cfg.timeout).toBe(1234);
            expect(cfg.headers["X-Key"]).toBe("k");
            expect(cfg.httpsAgent).toEqual(agent);
        });

        it("refuses to build a client without a service name or timeout", () => {
            expect(() => createClient({ timeout: 1 })).toThrow(/service/);
            expect(() => createClient({ service: "X" })).toThrow(/timeout/);
            expect(() => createClient({ service: "X", timeout: 0 })).toThrow(/timeout/);
        });

        it("parses a JSON string body like axios always does", async () => {
            respond(reply(200, "{\"a\":1}"));
            const res = await client().get("x");
            expect(res.data).toEqual({ a: 1 });
        });
    });

    describe("ApiError translation", () => {
        it("turns a 4xx into an http ApiError with status, code and body", async () => {
            respond(reply(404, { error: "no such report" }));
            const err = await client().get("x").catch((e) => e);
            expect(err).toBeInstanceOf(ApiError);
            expect(err).toBeInstanceOf(Error);
            expect(err).toMatchObject({
                name: "ApiError",
                service: "Testdienst",
                status: 404,
                code: "ERR_BAD_REQUEST",
                kind: "http",
                message: "Testdienst antwortete mit HTTP 404",
                data: { error: "no such report" },
            });
            expect(err.cause).toBeInstanceOf(axios.AxiosError);
            // axios' shape stays readable for older callers
            expect(err.response.status).toBe(404);
        });

        it("turns a timeout into a timeout ApiError naming the seconds", async () => {
            respond(timeout());
            const err = await client({ retry: false, timeout: 20000 }).get("x").catch((e) => e);
            expect(err).toMatchObject({ kind: "timeout", status: null, code: "ECONNABORTED", service: "Testdienst" });
            expect(err.message).toBe("Testdienst hat nicht innerhalb von 20s geantwortet.");
            expect(err.response).toBeUndefined();
            expect(err.data).toBeUndefined();
        });

        it("treats ETIMEDOUT as a timeout as well", async () => {
            respond(fail("connect ETIMEDOUT", "ETIMEDOUT"));
            const err = await client({ retry: false }).get("x").catch((e) => e);
            expect(err.kind).toBe("timeout");
        });

        it("turns a network failure into a network ApiError keeping the original message", async () => {
            respond(fail("socket hang up", "ECONNRESET"));
            const err = await client({ retry: false }).get("x").catch((e) => e);
            expect(err).toMatchObject({ kind: "network", status: null, code: "ECONNRESET", message: "socket hang up" });
        });

        it("reports a cancelled request as canceled and never retries it", async () => {
            const controller = new AbortController();
            controller.abort();
            transport.mockImplementation(() => Promise.resolve({ data: 1, status: 200, headers: {} }));
            const err = await client().get("x", { signal: controller.signal }).catch((e) => e);
            expect(err.kind).toBe("canceled");
            expect(transport).not.toHaveBeenCalled();
        });

        it("names a failed request without a message after the service", async () => {
            respond(() => Promise.reject(Object.assign(new Error(""), { config: {} })));
            const err = await client({ retry: false }).get("x").catch((e) => e);
            expect(err.message).toBe("Testdienst: Anfrage fehlgeschlagen");
        });
    });

    describe("retry", () => {
        it("defaults to two retries with a short backoff", () => {
            expect(DEFAULT_RETRY).toMatchObject({ retries: 2, delayMs: 250, timeouts: true });
            expect(DEFAULT_RETRY.methods).toEqual(["get", "head", "options", "put", "delete"]);
        });

        it("retries a 5xx on GET and answers the later success", async () => {
            respond(reply(502, "bad gateway"), reply(503, "busy"), reply(200, { ok: 1 }));
            const res = await client().get("x");
            expect(res.data).toEqual({ ok: 1 });
            expect(transport).toHaveBeenCalledTimes(3);
        });

        it("gives up after the configured retries with the last error", async () => {
            respond(reply(500, "a"), reply(500, "b"), reply(500, "c"), reply(200, "never"));
            const err = await client().get("x").catch((e) => e);
            expect(transport).toHaveBeenCalledTimes(3);
            expect(err).toMatchObject({ kind: "http", status: 500, data: "c" });
        });

        it("retries network errors and timeouts", async () => {
            respond(fail(), timeout(), reply(200, { ok: 1 }));
            const res = await client().get("x");
            expect(res.data).toEqual({ ok: 1 });
            expect(transport).toHaveBeenCalledTimes(3);
        });

        it("never retries a 4xx", async () => {
            respond(reply(429, "slow down"), reply(200, "never"));
            const err = await client().get("x").catch((e) => e);
            expect(transport).toHaveBeenCalledTimes(1);
            expect(err.status).toBe(429);
        });

        it("never retries a POST unless the client allows it", async () => {
            respond(reply(503, "busy"), reply(200, "never"));
            const err = await client().post("x", { a: 1 }).catch((e) => e);
            expect(transport).toHaveBeenCalledTimes(1);
            expect(err.status).toBe(503);

            transport.mockReset();
            respond(reply(503, "busy"), reply(200, { ok: 1 }));
            const res = await client({ retry: { methods: ["get", "post"] } }).post("x", { a: 1 });
            expect(res.data).toEqual({ ok: 1 });
            expect(transport).toHaveBeenCalledTimes(2);
            // the retried request carries the same body
            expect(sent(1).data).toBe(JSON.stringify({ a: 1 }));
        });

        it("skips timeouts when the client says so, but still retries network errors", async () => {
            respond(timeout(), reply(200, "never"));
            const err = await client({ retry: { timeouts: false } }).get("x").catch((e) => e);
            expect(err.kind).toBe("timeout");
            expect(transport).toHaveBeenCalledTimes(1);

            transport.mockReset();
            respond(fail(), reply(200, { ok: 1 }));
            const res = await client({ retry: { timeouts: false } }).get("x");
            expect(res.data).toEqual({ ok: 1 });
        });

        it("makes a single attempt with retry: false", async () => {
            respond(reply(500, "x"), reply(200, "never"));
            await expect(client({ retry: false }).get("x")).rejects.toMatchObject({ status: 500 });
            expect(transport).toHaveBeenCalledTimes(1);
        });

        it("lets one request override the client's policy", async () => {
            respond(reply(500, "x"), reply(200, "never"));
            await expect(client().get("x", { retry: false })).rejects.toMatchObject({ status: 500 });
            expect(transport).toHaveBeenCalledTimes(1);
        });

        it("waits delayMs, then twice that, between attempts", async () => {
            jest.useFakeTimers();
            try {
                respond(reply(500, "a"), reply(500, "b"), reply(200, { ok: 1 }));
                const http = createClient({ service: "S", timeout: 1000, retry: { delayMs: 100 } });
                const pending = http.get("https://x.test/");
                await jest.advanceTimersByTimeAsync(99);
                expect(transport).toHaveBeenCalledTimes(1);
                await jest.advanceTimersByTimeAsync(1);
                expect(transport).toHaveBeenCalledTimes(2);
                await jest.advanceTimersByTimeAsync(199);
                expect(transport).toHaveBeenCalledTimes(2);
                await jest.advanceTimersByTimeAsync(1);
                await expect(pending).resolves.toMatchObject({ data: { ok: 1 } });
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
