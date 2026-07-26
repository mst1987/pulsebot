jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(),
    csrfToken: jest.fn(),
}));

const auth = require("../../src/web/auth");
const { handle } = require("../../src/web/apiRouter");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

function body(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}

describe("web/apiRouter", () => {
    describe("GET /api/session", () => {
        it("returns user + csrfToken for a logged-in caller", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.csrfToken.mockReturnValue("csrf-abc");
            const res = mockRes();
            const handled = await handle("/api/session", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({
                data: { user: { id: "42", name: "Anna", isAdmin: true }, csrfToken: "csrf-abc" },
            });
        });

        it("returns user: null and no csrfToken for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(auth.csrfToken).not.toHaveBeenCalled();
            expect(body(res)).toEqual({ data: { user: null, csrfToken: null } });
        });
    });

    it("responds 404 with a JSON error for an unknown /api/ route", async () => {
        const res = mockRes();
        const handled = await handle("/api/does-not-exist", { method: "GET" }, res);
        expect(handled).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(body(res)).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    });
});
