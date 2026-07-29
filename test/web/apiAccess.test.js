const fs = require("fs");
const path = require("path");
const { checkAccess, AREA_BY_PATH, UNGATED, ANY_AREA } = require("../../src/web/apiAccess");
const { emptyAccess, AREA_IDS } = require("../../src/config/permissions");

const admin = { id: "1", name: "Admin", isAdmin: true };
const limited = (grants) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...grants } });

describe("web/apiAccess", () => {
    describe("checkAccess", () => {
        it("lets anyone reach /api/session so the client can bootstrap", () => {
            expect(checkAccess("/api/session", "GET", null)).toBeNull();
        });

        it("answers 401 for an anonymous caller on every other endpoint", () => {
            expect(checkAccess("/api/raids", "GET", null)).toMatchObject({ status: 401, code: "unauthorized" });
        });

        it("answers 403 for a logged-in user without any area", () => {
            expect(checkAccess("/api/raids", "GET", limited({}))).toMatchObject({ status: 403, code: "forbidden" });
        });

        it("lets a full admin through everywhere", () => {
            for (const pathname of Object.keys(AREA_BY_PATH)) {
                expect(checkAccess(pathname, "GET", admin)).toBeNull();
                expect(checkAccess(pathname, "POST", admin)).toBeNull();
            }
        });

        it("allows GET but refuses POST for a read-only area", () => {
            const user = limited({ raids: { read: true, write: false } });
            expect(checkAccess("/api/raids", "GET", user)).toBeNull();
            const denied = checkAccess("/api/raids/notify", "POST", user);
            expect(denied).toMatchObject({ status: 403, code: "forbidden" });
            expect(denied.message).toContain("Schreibrechte");
        });

        it("allows both for a write area", () => {
            const user = limited({ raids: { read: true, write: true } });
            expect(checkAccess("/api/raids", "GET", user)).toBeNull();
            expect(checkAccess("/api/raids/notify", "POST", user)).toBeNull();
        });

        it("keeps areas apart — access to one grants nothing in another", () => {
            const user = limited({ raids: { read: true, write: true } });
            expect(checkAccess("/api/cla", "GET", user)).toMatchObject({ status: 403 });
            expect(checkAccess("/api/history", "GET", user)).toMatchObject({ status: 403 });
            expect(checkAccess("/api/settings", "GET", user)).toMatchObject({ status: 403 });
        });

        it("lets any menu user switch the active guild", () => {
            expect(checkAccess("/api/session/guild", "POST", limited({ raids: { read: true, write: false } }))).toBeNull();
            expect(checkAccess("/api/session/guild", "POST", limited({}))).toMatchObject({ status: 403 });
        });

        // Fail-closed: a route added without a table entry must not become
        // reachable for a limited role just because it holds some other area.
        it("falls back to admin-only for endpoints missing from the table", () => {
            const user = limited({ raids: { read: true, write: true } });
            expect(checkAccess("/api/brand-new-thing", "GET", user)).toMatchObject({ status: 403 });
            expect(checkAccess("/api/brand-new-thing", "GET", admin)).toBeNull();
        });
    });

    describe("AREA_BY_PATH", () => {
        it("only maps to known areas", () => {
            for (const area of Object.values(AREA_BY_PATH)) expect(AREA_IDS).toContain(area);
        });

        it("maps nothing that the router doesn't serve", () => {
            for (const pathname of Object.keys(AREA_BY_PATH)) expect(routerPaths()).toContain(pathname);
        });

        // The gate is fail-closed, so forgetting an entry silently locks the
        // endpoint to full admins instead of erroring — this catches that.
        it("covers every endpoint the router serves", () => {
            const covered = new Set([...Object.keys(AREA_BY_PATH), ...UNGATED, ...ANY_AREA]);
            const uncovered = routerPaths().filter((p) => !covered.has(p));
            expect(uncovered).toEqual([]);
        });
    });
});

/** Every `pathname === "/api/…"` the route table in apiRouter.js dispatches on. */
function routerPaths() {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "apiRouter.js"), "utf8");
    return [...new Set([...source.matchAll(/pathname === "(\/api\/[^"]*)"/g)].map((m) => m[1]))];
}
