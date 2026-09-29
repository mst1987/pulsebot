const { sendJson, ok, okWithEtag, etagOf, matchesEtag, error } = require("../../../src/web/http/apiResponse");

const { mockRes } = require("../../helpers/http");

describe("web/http/apiResponse", () => {
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

    describe("okWithEtag (#555)", () => {
        const payload = { a: 1 };
        const tag = etagOf(JSON.stringify({ data: payload }));

        it("sends the body with a strong ETag of exactly that body", () => {
            const res = mockRes();
            okWithEtag({ headers: {} }, res, payload);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ ETag: tag, "Cache-Control": "no-cache" }));
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ data: payload }));
        });

        it("answers a bare 304 when If-None-Match names the tag", () => {
            const res = mockRes();
            okWithEtag({ headers: { "if-none-match": tag } }, res, payload);
            expect(res.writeHead).toHaveBeenCalledWith(304, { "Cache-Control": "no-cache", ETag: tag });
            expect(res.end).toHaveBeenCalledWith();
        });

        it("sends the body again for another tag or a request without headers", () => {
            const res = mockRes();
            okWithEtag({ headers: { "if-none-match": "\"old\"" } }, res, payload);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const bare = mockRes();
            okWithEtag(null, bare, payload);
            expect(bare.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        });

        it("matches a list, a weak form and the wildcard; an empty header matches nothing", () => {
            expect(matchesEtag(`"x", W/${tag}`, tag)).toBe(true);
            expect(matchesEtag("*", tag)).toBe(true);
            expect(matchesEtag("", tag)).toBe(false);
            expect(matchesEtag(undefined, tag)).toBe(false);
            expect(matchesEtag("\"other\"", tag)).toBe(false);
        });
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
