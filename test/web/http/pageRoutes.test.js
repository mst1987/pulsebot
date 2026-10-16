// The list of pages the server owns besides /api/* (#424). What each path
// answers is pinned by serverRoutes.test.js (golden master) and server.test.js;
// here: the list is well-formed, and the lookup keeps its first-fit order.
const { PAGE_ROUTES, findPageRoute, _internal: { matchPath, safeReturnPath } } = require("../../../src/web/http/pageRoutes");

const MATCHERS = ["exact", "prefix", "mount", "pattern"];

describe("web/http/pageRoutes", () => {
    it("gives every entry a name, a method, exactly one matcher and a handler", () => {
        const names = new Set();
        for (const route of PAGE_ROUTES) {
            expect(typeof route.name).toBe("string");
            expect(names.has(route.name)).toBe(false);
            names.add(route.name);
            expect(route.method).toMatch(/^(\*|GET|HEAD|DELETE)$/);
            expect(MATCHERS.filter((k) => route[k] !== undefined)).toHaveLength(1);
            expect(typeof route.handler).toBe("function");
        }
    });

    it("keeps the order the checks had in server.handle()", () => {
        expect(PAGE_ROUTES.map((r) => r.name)).toEqual([
            "api", "legacy-admin2", "legacy-admin", "auth-login", "auth-callback", "auth-logout", "report-delete",
            "health", "health-head", "calendar-user", "calendar-event", "event-comp", "event-page", "raidplan-map", "report-asset", "docs",
            "report-player", "report",
        ]);
    });

    it.each([
        ["GET", "/api/session", "api", []],
        ["PATCH", "/api/x", "api", []],
        ["POST", "/admin/raids", "legacy-admin", []],
        ["GET", "/admin2", "legacy-admin2", []],
        ["GET", "/auth/login", "auth-login", []],
        ["DELETE", "/r/abc", "report-delete", ["abc"]],
        ["GET", "/health", "health", []],
        ["HEAD", "/health", "health-head", []],
        ["GET", "/r/cal/user/tok_1.ics", "calendar-user", ["tok_1"]],
        ["GET", "/r/cal/eh-1.ics", "calendar-event", ["eh-1"]],
        ["GET", "/e/eh-1/comp", "event-comp", ["eh-1"]],
        ["GET", "/e/eh-1/", "event-page", ["eh-1"]],
        ["GET", "/rp-map/t/abc/kara", "raidplan-map", ["t/abc/kara"]],
        ["GET", "/r-assets/report.css", "report-asset", []],
        ["GET", "/docs/", "docs", []],
        ["GET", "/r/abc/p/3", "report-player", ["abc", "3"]],
        ["GET", "/r/abc", "report", ["abc"]],
    ])("%s %s → %s", (method, pathname, name, params) => {
        const hit = findPageRoute(method, pathname);
        expect(hit.route.name).toBe(name);
        expect(hit.params).toEqual(params);
    });

    it.each([
        ["POST", "/auth/login"],
        ["GET", "/r/abc/p/x"],
        ["DELETE", "/r/abc/p/1"],
        ["HEAD", "/health/"],
        ["GET", "/"],
        ["GET", "/administration"],
        ["GET", "/docs/x"],
    ])("finds nothing for %s %s (405 or the client)", (method, pathname) => {
        expect(findPageRoute(method, pathname)).toBeNull();
    });

    it("hands a mount the part below it", () => {
        expect(matchPath({ mount: "/admin" }, "/admin")).toEqual({ params: [], rest: "" });
        expect(matchPath({ mount: "/admin" }, "/admin/raids/x")).toEqual({ params: [], rest: "/raids/x" });
        expect(matchPath({ mount: "/admin" }, "/admin2")).toBeNull();
        expect(matchPath({ prefix: "/r-assets/" }, "/r-assets/a.css")).toEqual({ params: [], rest: "a.css" });
    });

    it.each([
        "/addon/levelhelper",
        "/",
        "/raids/detail?event=eh-1&tab=setup",
        "/history#x",
        "/history/char?name=%C3%9Cbel",
        "/administration",
    ])("keeps the login's return path %s", (path) => {
        expect(safeReturnPath(path)).toBe(path);
    });

    it.each([
        ["another host", "//evil.example/x"],
        ["a scheme", "https://evil.example"],
        ["a javascript url", "javascript:alert(1)"],
        ["a backslash", "/\\evil.example"],
        ["a leading backslash", "\\\\evil.example"],
        ["a tab the browser drops", "/\t/evil.example"],
        ["a newline", "/x\nLocation: //evil.example"],
        ["a space", "/ /evil.example"],
        ["a relative path", "addon/levelhelper"],
        ["the login itself", "/auth/login?returnTo=/x"],
        ["the auth root", "/auth"],
        ["nothing", ""],
        ["no string", null],
        ["too long", `/${"a".repeat(600)}`],
        ["an encoded second slash", "/%2F%2Fevil.example"],
        ["an encoded backslash", "/%5Cevil.example"],
        ["the old /admin mount", "/admin//evil.example"],
        ["the old /admin mount bare", "/admin"],
        ["the old /admin2 mount", "/admin2/x"],
        ["the /admin mount encoded", "/%61dmin//evil.example"],
        ["an encoded newline", "/x%0A"],
        ["a broken escape", "/x%E0%A4%A"],
        ["a character above ASCII", "/x "],
        ["a DEL", "/x\u007f"],
    ])("drops a return path with %s", (_why, path) => {
        expect(safeReturnPath(path)).toBe("");
    });

    it("answers with the first fitting entry of the list it is given", () => {
        const first = { name: "a", method: "*", prefix: "/x", handler() {} };
        const second = { name: "b", method: "GET", exact: "/x/y", handler() {} };
        expect(findPageRoute("GET", "/x/y", [first, second]).route).toBe(first);
        expect(findPageRoute("GET", "/x/y", [second, first]).route).toBe(second);
    });
});
