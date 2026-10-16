// withUser() (src/web/http/apiHandler.js, #421): the preamble of a session-authenticated
// /api/* handler — menu user or full admin, write right, CSRF, JSON body — in the
// order the handlers always ran it, each refusal sent by the middleware it came from.
const { EventEmitter } = require("events");
const { mockRes, status, json: sent, jsonRequest } = require("../../helpers/http");

let mockUser = null;
let mockCsrf = true;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => mockCsrf),
}));
// The write guard of an archived event (#563): steered per test.
let mockArchived = new Set();
jest.mock("../../../src/services/events/eventArchive", () => ({
    archivedRefusal: jest.fn((ids) => {
        const hit = [].concat(ids || []).find((id) => mockArchived.has(id));
        return hit ? { status: 409, code: "archived", message: `Archiv: ${hit}` } : null;
    }),
}));

// The category orga (#724): steered per test - who manages some roster, which events are theirs.
let mockManagers = new Set();
let mockOwnEvents = new Set();
jest.mock("../../../src/services/roster/categoryOrga", () => {
    const caches = new WeakMap();
    return {
        requestCache: jest.fn((req) => {
            if (!caches.has(req)) caches.set(req, { roles: new Map() });
            return caches.get(req);
        }),
        isAnyCategoryManager: jest.fn(async (user) => mockManagers.has(user.id)),
        canOrgaEvent: jest.fn(async (user, event, opts) => {
            if (opts && opts.loadGroups) await opts.loadGroups();
            return mockManagers.has(user.id) && mockOwnEvents.has(typeof event === "object" ? event.id : event);
        }),
    };
});
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
    eventLookbackSince: jest.fn(() => 123),
}));

const { withUser } = require("../../../src/web/http/apiHandler");
const categoryOrga = require("../../../src/services/roster/categoryOrga");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { emptyAccess } = require("../../../src/config/permissions");

const admin = { id: "1", name: "Admin", isAdmin: true };
const limited = (grants) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...grants } });


/** Runs a wrapped handler like the router does, feeding `json` as the request body. */
async function call(handler, { method = "POST", json, url } = {}) {
    const req = jsonRequest(method, "/", json, { "x-csrf-token": "tok" });
    const res = mockRes();
    await handler(req, res, url);
    return res;
}

describe("web/http/apiHandler withUser", () => {
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

    it("lets `orga` through only the orga - a full admin or an orga role, never an area right", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        mockUser = limited({ raids: { read: true, write: true } });
        const res = await call(withUser({ orga: true }, fn), { method: "GET" });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("orga_only");
        expect(fn).not.toHaveBeenCalled();
        mockUser = { ...limited({ raids: { read: true, write: false } }), isOrga: true };
        await call(withUser({ orga: true }, fn), { method: "GET" });
        mockUser = admin;
        await call(withUser({ orga: true }, fn), { method: "GET" });
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

// `archived` (#563): a write on an event of a hidden game version is refused
// before the handler runs; everything else passes.
describe("web/http/apiHandler withUser archived", () => {
    beforeEach(() => {
        mockUser = admin;
        mockCsrf = true;
        mockArchived = new Set(["old"]);
    });

    it("answers 409 archived for an archived event and never calls the handler", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        const res = await call(withUser({ csrf: true, body: true, archived: (body) => body.event }, fn), { json: { event: "old" } });
        expect(status(res)).toBe(409);
        expect(sent(res).error).toMatchObject({ code: "archived", message: "Archiv: old" });
        expect(fn).not.toHaveBeenCalled();
    });

    it("lets a normal event and a list without an archived one through", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({ csrf: true, body: true, archived: (body) => body.event }, fn), { json: { event: "new" } });
        await call(withUser({ csrf: true, body: true, archived: (body) => body.ids }, fn), { json: { ids: ["a", "b"] } });
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("can read the event from the query", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        const url = new URL("http://x/api/thing?event=old");
        const res = await call(withUser({ csrf: true, archived: (_body, query) => query.get("event") }, fn), { url });
        expect(status(res)).toBe(409);
        expect(fn).not.toHaveBeenCalled();
    });
});

// `orgaScoped` (#724): the global orga as with `orga: true`, and besides them the orga of the
// category of every event the route names.
describe("web/http/apiHandler withUser orgaScoped", () => {
    const BY_EVENT = (body, query) => body.event || query.get("event");
    const manager = () => limited({ raids: { read: true, write: false } });

    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = admin;
        mockCsrf = true;
        mockArchived = new Set();
        mockManagers = new Set(["7"]);
        mockOwnEvents = new Set(["mine", "mine2"]);
    });

    it("refuses a wrong definition and marks the wrapper for the route table", () => {
        expect(() => withUser({ orgaScoped: true }, jest.fn())).toThrow("orgaScoped");
        expect(() => withUser({ orga: true, orgaScoped: BY_EVENT }, jest.fn())).toThrow("exclude");
        expect(withUser({ orgaScoped: BY_EVENT }, jest.fn()).orgaScoped).toBe(true);
        expect(withUser({ orga: true }, jest.fn()).orgaScoped).toBeUndefined();
    });

    it("lets the global orga through like `orga: true` - write still asked, no event check", async () => {
        const fn = jest.fn(({ res }) => res.end("{}"));
        mockUser = admin;
        await call(withUser({ orgaScoped: BY_EVENT, write: "raids", body: true }, fn), { json: { event: "foreign" } });
        mockUser = { ...limited({ raids: { read: true, write: true } }), id: "9", isOrga: true };
        await call(withUser({ orgaScoped: BY_EVENT, write: "raids", body: true }, fn), { json: { event: "foreign" } });
        expect(fn).toHaveBeenCalledTimes(2);
        expect(categoryOrga.canOrgaEvent).not.toHaveBeenCalled();
        expect(categoryOrga.isAnyCategoryManager).not.toHaveBeenCalled();

        mockUser = { ...limited({ raids: { read: true, write: false } }), id: "9", isOrga: true };
        const res = await call(withUser({ orgaScoped: BY_EVENT, write: "raids", body: true }, fn), { json: { event: "foreign" } });
        expect(sent(res).error.code).toBe("forbidden");
    });

    it("refuses who is neither global nor category orga with orga_only, before the body", async () => {
        mockUser = { ...limited({ raids: { read: true, write: true } }), id: "8" };
        const fn = jest.fn();
        const res = await call(withUser({ orgaScoped: BY_EVENT, write: "raids", body: true }, fn), { json: { event: "mine" } });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("orga_only");
        expect(categoryOrga.canOrgaEvent).not.toHaveBeenCalled();
        expect(fn).not.toHaveBeenCalled();
    });

    it("lets a category orga act on the events of their category, without the area's write right", async () => {
        mockUser = manager();
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true }, fn), { json: { event: "mine" } });
        await call(withUser({ orgaScoped: BY_EVENT, write: "raids" }, fn), { method: "GET", url: new URL("http://x/api/t?event=mine") });
        await call(withUser({ orgaScoped: (body) => body.ids, body: true }, fn), { json: { ids: ["mine", "mine2"] } });
        // a row is handed on as it is; the server's record decides (categoryOrga.resolveEvent)
        await call(withUser({ orgaScoped: (body) => ({ id: body.event }), body: true }, fn), { json: { event: "mine" } });
        expect(fn).toHaveBeenCalledTimes(4);
        // the category path asks the roster only, never the global orga
        expect(categoryOrga.canOrgaEvent.mock.calls.every(([, , opts]) => opts.managerOnly === true)).toBe(true);
    });

    it("never gives a global orga without the write right less than a manager (#724 review)", async () => {
        // an orga role with `raids` read only, which manages the roster of "mine"
        mockUser = { ...manager(), isOrga: true };
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({ orgaScoped: BY_EVENT, write: "raids", body: true }, fn), { json: { event: "mine" } });
        expect(fn).toHaveBeenCalledTimes(1);
        const res = await call(withUser({ orgaScoped: BY_EVENT, write: "raids", body: true }, fn), { json: { event: "foreign" } });
        expect(sent(res).error.code).toBe("not_category_orga");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("takes the category path for a global orga the area gate let in as a manager", async () => {
        const req = jsonRequest("POST", "/", { event: "foreign" }, { "x-csrf-token": "tok" });
        mockUser = { ...manager(), isOrga: true };
        categoryOrga.requestCache(req).areaViaCategory = true;
        const fn = jest.fn();
        const res = mockRes();
        await withUser({ orgaScoped: BY_EVENT, body: true }, fn)(req, res);
        expect(sent(res).error.code).toBe("not_category_orga");
        expect(fn).not.toHaveBeenCalled();
    });

    it("answers not_category_orga for an event of another category, a mixed list and no event at all", async () => {
        mockUser = manager();
        const fn = jest.fn();
        for (const json of [{ event: "foreign" }, { ids: ["mine", "foreign"] }, {}, { ids: [] }, { ids: ["mine", ""] }, { ids: ["mine", null] }]) {
            const res = await call(withUser({ orgaScoped: (body) => body.event || body.ids, body: true }, fn), { json });
            expect(status(res)).toBe(403);
            expect(sent(res).error).toEqual({ code: "not_category_orga", message: "Das darf nur die Orga dieser Kategorie." });
        }
        expect(fn).not.toHaveBeenCalled();
    });

    it("answers a foreign archived raid with not_category_orga, not with the archive", async () => {
        mockUser = manager();
        mockArchived = new Set(["foreign"]);
        const res = await call(withUser({ orgaScoped: BY_EVENT, csrf: true, body: true, archived: BY_EVENT }, jest.fn()), { json: { event: "foreign" } });
        expect(sent(res).error.code).toBe("not_category_orga");
    });

    it("still checks CSRF first and the archive for an own raid", async () => {
        mockUser = manager();
        mockCsrf = false;
        let res = await call(withUser({ orgaScoped: BY_EVENT, csrf: true, body: true }, jest.fn()), { json: { event: "mine" } });
        expect(sent(res).error.code).toBe("csrf");
        mockCsrf = true;
        mockArchived = new Set(["mine"]);
        res = await call(withUser({ orgaScoped: BY_EVENT, csrf: true, body: true, archived: BY_EVENT }, jest.fn()), { json: { event: "mine" } });
        expect(status(res)).toBe(409);
    });

    it("shares the request's role cache and loads the caller's event groups on demand", async () => {
        mockUser = manager();
        const fn = jest.fn(({ res }) => res.end("{}"));
        await call(withUser({ orgaScoped: BY_EVENT, body: true }, fn), { json: { event: "mine" } });
        const cacheOfGate = categoryOrga.isAnyCategoryManager.mock.calls[0][1].cache;
        expect(categoryOrga.canOrgaEvent.mock.calls[0][2].cache).toBe(cacheOfGate);
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 123 });
    });

    // `globalByWrite` (#726): the raid plan's area is handed to people outside the orga - its write right
    // alone is the global path.
    describe("globalByWrite", () => {
        const PLAN = { orgaScoped: BY_EVENT, globalByWrite: true, write: "raidplan", body: true };

        it("needs orgaScoped and write", () => {
            expect(() => withUser({ globalByWrite: true, write: "raidplan" }, jest.fn())).toThrow("globalByWrite");
            expect(() => withUser({ globalByWrite: true, orgaScoped: BY_EVENT }, jest.fn())).toThrow("globalByWrite");
        });

        it("lets the write right through for every event, without an orga rank and without asking a roster", async () => {
            mockUser = { ...limited({ raidplan: { read: true, write: true } }), id: "8" };
            const fn = jest.fn(({ res }) => res.end("{}"));
            await call(withUser(PLAN, fn), { json: { event: "foreign" } });
            await call(withUser(PLAN, fn), { json: {} });
            expect(fn).toHaveBeenCalledTimes(2);
            expect(categoryOrga.isAnyCategoryManager).not.toHaveBeenCalled();
            expect(categoryOrga.canOrgaEvent).not.toHaveBeenCalled();
        });

        it("sends everybody else down the category path - a global orga without the write right too", async () => {
            const fn = jest.fn(({ res }) => res.end("{}"));
            for (const user of [limited({ raidplan: { read: true, write: false } }), { ...limited({ raidplan: { read: true, write: false } }), isOrga: true }]) {
                mockUser = user;
                await call(withUser(PLAN, fn), { json: { event: "mine" } });
                const res = await call(withUser(PLAN, fn), { json: { event: "foreign" } });
                expect(sent(res).error.code).toBe("not_category_orga");
            }
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it("refuses who lacks the write right and manages no roster with forbidden, not orga_only", async () => {
            mockUser = { ...limited({ raidplan: { read: true, write: false } }), id: "8" };
            const res = await call(withUser(PLAN, jest.fn()), { json: { event: "mine" } });
            expect(status(res)).toBe(403);
            expect(sent(res).error.code).toBe("forbidden");
        });
    });
});
