// The HTTP scaffolding the route suites share (#433).
const { mockRes, status, json, body, jsonRequest, apiMiddlewareMock, apiBodyMock } = require("./http");
const { readJsonBody, readRawBody } = require("../../src/web/http/apiBody");
const { ok, error } = require("../../src/web/http/apiResponse");

describe("test/helpers/http", () => {
    it("reads status, envelope and payload of an ok() answer", () => {
        const res = mockRes();
        ok(res, { a: 1 }, 201);
        expect(status(res)).toBe(201);
        expect(json(res)).toEqual({ data: { a: 1 } });
        expect(body(res)).toEqual({ a: 1 });
    });

    it("hands back the whole envelope of an error answer", () => {
        const res = mockRes();
        error(res, 404, "not_found", "weg");
        expect(status(res)).toBe(404);
        expect(body(res)).toEqual({ error: { code: "not_found", message: "weg" } });
        expect(typeof res.setHeader).toBe("function");
    });

    it("keeps a falsy data payload", () => {
        const res = mockRes();
        ok(res, null);
        expect(body(res)).toBeNull();
    });

    it("feeds a JSON body to readJsonBody, however late it subscribes", async () => {
        const req = jsonRequest("POST", "/api/x", { name: "Kara" }, { "x-csrf-token": "tok" });
        expect(req).toMatchObject({ method: "POST", url: "/api/x", headers: { "x-csrf-token": "tok" } });
        await Promise.resolve();
        await expect(readJsonBody(req)).resolves.toEqual({ name: "Kara" });
    });

    it("ends a request without a payload with an empty body", async () => {
        await expect(readJsonBody(jsonRequest("POST", "/api/x"))).resolves.toEqual({});
        const raw = await readRawBody(jsonRequest("POST", "/api/x", { a: 1 }), 1000);
        expect(raw.toString()).toBe("{\"a\":1}");
    });

    describe("apiMiddlewareMock", () => {
        it("answers the given user, the full admin and the CSRF check", () => {
            let mockUser = { id: "7" };
            const mw = apiMiddlewareMock({ user: () => mockUser, fullAdmin: { id: "full" } });
            expect(mw.requireAdmin({}, mockRes())).toEqual({ id: "7" });
            expect(mw.requireFullAdmin({}, mockRes())).toEqual({ id: "full" });
            expect(mw.requireCsrf({}, mockRes())).toBe(true);
            mockUser = { id: "8" };
            expect(mw.requireAdmin({}, mockRes())).toEqual({ id: "8" });
        });

        it("refuses like the real middleware: 401 without a user, 403 on a bad token", () => {
            const mw = apiMiddlewareMock({ user: null, csrf: false });
            const anon = mockRes();
            expect(mw.requireAdmin({}, anon)).toBeNull();
            expect(status(anon)).toBe(401);
            expect(body(anon).error.code).toBe("unauthorized");
            const forged = mockRes();
            expect(mw.requireCsrf({}, forged)).toBe(false);
            expect(status(forged)).toBe(403);
            expect(body(forged).error.code).toBe("csrf");
        });

        it("defaults to a full admin", () => {
            expect(apiMiddlewareMock().requireFullAdmin({}, mockRes())).toMatchObject({ isAdmin: true });
        });
    });

    it("apiBodyMock resolves the given body, per call when it is a function", async () => {
        let mockBody = { a: 1 };
        const mod = apiBodyMock({ body: () => mockBody });
        await expect(mod.readJsonBody()).resolves.toEqual({ a: 1 });
        mockBody = { b: 2 };
        await expect(mod.readJsonBody()).resolves.toEqual({ b: 2 });
        await expect(apiBodyMock().readJsonBody()).resolves.toEqual({});
        expect((await apiBodyMock().readRawBody()).length).toBe(0);
    });
});
