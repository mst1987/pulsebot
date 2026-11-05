// routeTable.js (#421): the one table of every /api/* route, collected from the
// `routes` export of each apiRoutes/*.js — what the router dispatches on and
// what the access gate reads its areas from.
const fs = require("fs");
const path = require("path");
const { ROUTES, MODULES, find, methodsFor, areasOf } = require("../../../src/web/http/routeTable");
// The dispatch list of the hand-written router this table replaced: one
// "METHOD path" per if-block, captured verbatim before the rebuild.
const golden = require("./fixtures/apiRoutes.golden.json");

describe("web/http/routeTable: a bad table fails at load", () => {
    const FIRST = "../../../src/web/apiRoutes/system/session";
    const handler = () => {};
    const good = { method: "GET", path: "/api/x", handler };

    /** The message of what loading the table throws when the first module exports `mod`. */
    function loadError(mod) {
        let message = "";
        jest.isolateModules(() => {
            jest.doMock(FIRST, () => mod);
            try {
                require("../../../src/web/http/routeTable");
            } catch (err) {
                message = err.message;
            }
        });
        jest.dontMock(FIRST);
        return message;
    }

    it.each([
        ["no table", {}, "exports no routes table"],
        ["a bad method", { routes: [{ ...good, method: "TRACE" }] }, "bad method"],
        ["no entry", { routes: [null] }, "bad method"],
        ["a bad path", { routes: [{ ...good, path: "/x" }] }, "bad path"],
        ["no handler", { routes: [{ ...good, handler: null }] }, "has no handler"],
        ["a route twice", { routes: [good, good] }, "registered twice"],
        ["sharedData on a rank route", { routes: [{ ...good, sharedData: true, handler: Object.assign(() => {}, { serverAdmin: true }) }] }, "is sharedData and serverAdmin"],
    ])("refuses %s", (_label, mod, expected) => {
        expect(loadError(mod)).toContain(expected);
    });
});

describe("web/http/routeTable", () => {
    it("registers exactly the routes the old router dispatched, no more, no fewer", () => {
        const now = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
        expect(now).toEqual([...golden].sort());
    });

    it("collects every module under apiRoutes/ and its subfolders — a new file is not forgotten", () => {
        const files = fs.readdirSync(path.join(__dirname, "..", "..", "..", "src", "web", "apiRoutes"), { recursive: true })
            .map((f) => f.split(path.sep).join("/"))
            .filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")).sort();
        expect([...MODULES].sort()).toEqual(files);
    });

    it("has a function handler, a method and an /api/ path on every entry", () => {
        for (const r of ROUTES) {
            expect(typeof r.handler).toBe("function");
            expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(r.method);
            expect(r.path.startsWith("/api/")).toBe(true);
            expect(typeof r.module).toBe("string");
        }
    });

    it("registers each method + path once", () => {
        const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("finds a route by method and path, and nothing for the wrong method", () => {
        expect(find("GET", "/api/dashboard")).toMatchObject({ path: "/api/dashboard", area: ["dashboard", "signup"], module: "system/dashboard" });
        expect(find("POST", "/api/dashboard")).toBeNull();
        expect(find("GET", "/api/nope")).toBeNull();
    });

    it("lists the methods a path answers to", () => {
        expect(methodsFor("/api/channels")).toEqual(["GET", "POST", "PATCH"]);
        expect(methodsFor("/api/raid-templates")).toEqual(["GET", "POST", "PATCH", "DELETE"]);
        expect(methodsFor("/api/nope")).toEqual([]);
    });

    it("gives the areas of an entry as an array", () => {
        expect(areasOf(find("GET", "/api/history"))).toEqual(["history", "loot"]);
        expect(areasOf(find("GET", "/api/roster"))).toEqual(["roster"]);
        expect(areasOf(find("GET", "/api/session"))).toEqual([]);
        expect(areasOf(null)).toEqual([]);
    });

    it("keeps a route's areas the same for every method of its path", () => {
        const byPath = new Map();
        for (const r of ROUTES) {
            const key = JSON.stringify(areasOf(r));
            if (byPath.has(r.path)) expect({ path: r.path, areas: key }).toEqual({ path: r.path, areas: byPath.get(r.path) });
            byPath.set(r.path, key);
        }
    });

    it("freezes the table so no module can edit another's entry", () => {
        expect(Object.isFrozen(ROUTES)).toBe(true);
        expect(Object.isFrozen(ROUTES[0])).toBe(true);
    });

    it("lets every handler through with a (req, res, url) call signature", () => {
        // the router always passes three arguments; a handler that wants none is fine
        for (const r of ROUTES) expect(r.handler.length).toBeLessThanOrEqual(3);
    });
});
