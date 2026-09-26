// withUser() (src/web/apiHandler.js, #421): the preamble of a session-authenticated
// /api/* handler — menu user or full admin, write right, CSRF, JSON body — in the
// order the handlers always ran it, each refusal sent by the middleware it came from.
const { EventEmitter } = require("events");

let mockUser = null;
let mockCsrf = true;
jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => mockCsrf),
}));

const { withUser } = require("../../src/web/apiHandler");
const { emptyAccess } = require("../../src/config/permissions");

const admin = { id: "1", name: "Admin", isAdmin: true };
const limited = (grants) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...grants } });

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
const sent = (res) => JSON.parse(res.end.mock.calls[0][0]);
const status = (res) => res.writeHead.mock.calls[0][0];

/** Runs a wrapped handler like the router does, feeding `json` as the request body. */
async function call(handler, { method = "POST", json, url } = {}) {
    const req = new EventEmitter();
    req.method = method;
    req.headers = { "x-csrf-token": "tok" };
    const res = mockRes();
    const p = handler(req, res, url);
    if (json !== undefined) req.emit("data", JSON.stringify(json));
    req.emit("end");
    await p;
    return res;
}

describe("web/apiHandler withUser", () => {
    beforeEach(() => {
        mockUser = admin;
        mockCsrf = true;
    });

    it("hands the handler user, body, query, url, req and res", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        const url = new URL("http://x/api/thing?event=ev1");
        await call(withUser({ csrf: true, body: true }, fn), { json: { a: 1 }, url });
        const ctx = fn.mock.calls[0][0];
        expect(ctx.user).toBe(admin);
        expect(ctx.body).toEqual({ a: 1 });
        expect(ctx.query.get("event")).toBe("ev1");
        expect(ctx.url).toBe(url);
        expect(ctx.req.method).toBe("POST");
        expect(typeof ctx.res.end).toBe("function");
    });

    it("answers 401 for an anonymous caller and never runs the handler", async () => {
        mockUser = null;
        const fn = jest.fn();
        const res = await call(withUser({}, fn), { json: {} });
        expect(status(res)).toBe(401);
        expect(sent(res).error.code).toBe("unauthorized");
        expect(fn).not.toHaveBeenCalled();
    });

    it("answers 403 for an account without any menu area", async () => {
        mockUser = limited({});
        const fn = jest.fn();
        const res = await call(withUser({}, fn), { json: {} });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("forbidden");
        expect(fn).not.toHaveBeenCalled();
    });

    it("lets a limited menu user through without `full`, and refuses them with it", async () => {
        mockUser = limited({ settings: { read: true, write: true } });
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({}, fn), { json: {} });
        expect(fn).toHaveBeenCalledTimes(1);
        const res = await call(withUser({ full: true }, fn), { json: {} });
        expect(status(res)).toBe(403);
        expect(sent(res).error.message).toContain("Voll-Admins");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("refuses a caller without write on the named area, naming the area", async () => {
        mockUser = limited({ raids: { read: true, write: false } });
        const fn = jest.fn();
        const res = await call(withUser({ write: "raids" }, fn), { method: "GET" });
        expect(status(res)).toBe(403);
        expect(sent(res).error).toEqual({ code: "forbidden", message: "Keine Schreibrechte für „Raid-Events“." });
        expect(fn).not.toHaveBeenCalled();
    });

    it("lets a writer of the area and a full admin through the write check", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        mockUser = limited({ raids: { read: true, write: true } });
        await call(withUser({ write: "raids" }, fn), { method: "GET" });
        mockUser = admin;
        await call(withUser({ write: "raids" }, fn), { method: "GET" });
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("refuses a bad CSRF token with 403 before reading the body", async () => {
        mockCsrf = false;
        const fn = jest.fn();
        const res = await call(withUser({ csrf: true, body: true }, fn), { json: { a: 1 } });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("csrf");
        expect(fn).not.toHaveBeenCalled();
    });

    it("does not check CSRF unless asked (a GET)", async () => {
        mockCsrf = false;
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({}, fn), { method: "GET" });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("checks the write right before the CSRF token, like the handlers did", async () => {
        mockUser = limited({ raids: { read: true, write: false } });
        mockCsrf = false;
        const res = await call(withUser({ write: "raids", csrf: true }, jest.fn()), { json: {} });
        expect(sent(res).error.code).toBe("forbidden");
    });

    it("gives an empty or broken body as {} and leaves the body out when not asked for", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({ body: true }, fn), {});
        expect(fn.mock.calls[0][0].body).toEqual({});
        const req = new EventEmitter();
        req.method = "POST";
        req.headers = {};
        const p = withUser({ body: true }, fn)(req, mockRes());
        req.emit("data", "{not json");
        req.emit("end");
        await p;
        expect(fn.mock.calls[1][0].body).toEqual({});
        await call(withUser({}, fn), { method: "GET" });
        expect(fn.mock.calls[2][0].body).toBeUndefined();
    });

    it("gives an empty query when the router passes no url", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({}, fn), { method: "GET" });
        const ctx = fn.mock.calls[0][0];
        expect(ctx.url).toBeUndefined();
        expect(ctx.query.get("anything")).toBeNull();
    });

    it("returns what the handler returns and lets its exception escape to the router", async () => {
        const value = await withUser({}, async () => 42)({ method: "GET", headers: {} }, mockRes());
        expect(value).toBe(42);
        await expect(withUser({}, async () => { throw new Error("boom"); })({ method: "GET", headers: {} }, mockRes())).rejects.toThrow("boom");
    });

    it("accepts the handler alone, without options", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser(fn), { method: "GET" });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
