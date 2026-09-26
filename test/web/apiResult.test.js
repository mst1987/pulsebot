// apiResult.js (#421): the one "this failed" shape between service modules and
// the /api layer — fail(), the code→status table, sendFailure/sendResult, AppError.
const { AppError, fail, HTTP_BY_CODE, sendFailure, sendResult } = require("../../src/web/apiResult");

const { mockRes, status, json } = require("../helpers/http");

describe("web/apiResult", () => {
    it("fail() builds the status-carrying error shape the services answer with", () => {
        expect(fail(404, "not_found", "Event nicht gefunden.")).toEqual({ error: { status: 404, code: "not_found", message: "Event nicht gefunden." } });
    });

    describe("sendResult", () => {
        it("sends the error with the status it names", () => {
            const res = mockRes();
            sendResult(res, fail(409, "cancelled", "Das Event ist abgesagt."));
            expect(status(res)).toBe(409);
            expect(json(res)).toEqual({ error: { code: "cancelled", message: "Das Event ist abgesagt." } });
        });

        it("sends a success as { data } with the result's status, 200 by default", () => {
            const res = mockRes();
            sendResult(res, { body: { message: "ok" } });
            expect(status(res)).toBe(200);
            expect(json(res)).toEqual({ data: { message: "ok" } });
            const created = mockRes();
            sendResult(created, { status: 201, body: { id: "x" } });
            expect(status(created)).toBe(201);
        });
    });

    describe("sendFailure", () => {
        it("maps the short codes to their status and falls back to 400", () => {
            for (const [code, expected] of Object.entries(HTTP_BY_CODE)) {
                const res = mockRes();
                sendFailure(res, { code, error: "x" });
                expect({ code, status: status(res) }).toEqual({ code, status: expected });
            }
            const res = mockRes();
            sendFailure(res, { code: "something_else", error: "x" });
            expect(status(res)).toBe(400);
        });

        // The per-route maps this table replaced (apiRoutes/setup.js, raidplan.js)
        it("keeps the statuses those maps gave", () => {
            expect(HTTP_BY_CODE).toMatchObject({
                not_found: 404, conflict: 409, invalid: 400, too_large: 413,
                raidhelper: 409, no_setup: 400, no_approved_setup: 400, cancelled: 409, no_channel: 400, discord: 502,
            });
        });

        it("fills in a code and a message when the result has none", () => {
            const res = mockRes();
            sendFailure(res, {});
            expect(json(res)).toEqual({ error: { code: "failed", message: "Fehlgeschlagen." } });
        });

        it("takes a table of its own when a route needs other statuses", () => {
            const res = mockRes();
            sendFailure(res, { code: "teapot", error: "x" }, { teapot: 418 });
            expect(status(res)).toBe(418);
        });
    });

    describe("AppError", () => {
        it("carries code, status and message and is an Error", () => {
            const e = new AppError("post_failed", 502, "Konnte nicht posten.");
            expect(e).toBeInstanceOf(Error);
            expect(e.name).toBe("AppError");
            expect(e.code).toBe("post_failed");
            expect(e.status).toBe(502);
            expect(e.message).toBe("Konnte nicht posten.");
        });

        it("defaults to 400 and uses the code as message when none is given", () => {
            const e = new AppError("invalid");
            expect(e.status).toBe(400);
            expect(e.message).toBe("invalid");
        });
    });
});
