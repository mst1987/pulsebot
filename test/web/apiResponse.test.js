const { sendJson, ok, error } = require("../../src/web/apiResponse");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

describe("web/apiResponse", () => {
    it("sendJson writes the status, JSON content type, and serialized body", () => {
        const res = mockRes();
        sendJson(res, 201, { foo: "bar" });
        expect(res.writeHead).toHaveBeenCalledWith(201, expect.objectContaining({
            "Content-Type": "application/json; charset=utf-8",
        }));
        expect(res.end).toHaveBeenCalledWith(JSON.stringify({ foo: "bar" }));
    });

    it("ok wraps the payload as { data } with a 200 default", () => {
        const res = mockRes();
        ok(res, { id: 1 });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(res.end).toHaveBeenCalledWith(JSON.stringify({ data: { id: 1 } }));
    });

    it("ok honors a custom status code", () => {
        const res = mockRes();
        ok(res, { created: true }, 201);
        expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it("error wraps code/message as { error } with the given status", () => {
        const res = mockRes();
        error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(res.end).toHaveBeenCalledWith(JSON.stringify({
            error: { code: "not_found", message: "Unbekannter API-Endpunkt." },
        }));
    });
});
