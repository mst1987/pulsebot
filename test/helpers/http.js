// The HTTP scaffolding of the route suites (#433): a fake response, a request
// that carries a JSON body, and ready-made factory mocks for the two modules
// every /api/* handler reads through (apiMiddleware, apiBody).
//
//   jest.mock("../../src/web/apiMiddleware", () => require("../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
//   jest.mock("../../src/web/apiBody", () => require("../helpers/http").apiBodyMock());
//   const { mockRes, status, body } = require("../helpers/http");
//
// A handler keeps its signature `(req, res, url)`; the helpers only stand in
// for Node's IncomingMessage / ServerResponse.
const { EventEmitter } = require("events");

/** A ServerResponse stand-in: writeHead / end / setHeader are jest.fn. */
function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() };
}

/** The status code of the (first) writeHead call. */
function status(res) {
    return res.writeHead.mock.calls[0][0];
}

/** The parsed JSON of the (first) end call - the whole envelope, `{ data }` or `{ error }`. */
function json(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}

/** The payload of an `ok()` answer (the envelope's `data`), else the whole envelope (an error). */
function body(res) {
    const parsed = json(res);
    return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

/**
 * An IncomingMessage stand-in carrying `payload` as a JSON body. The body is
 * sent once a reader subscribes to "end" (readJsonBody / readRawBody), a
 * microtask later - so it does not matter whether the handler reads it right
 * away or after an await. Without a payload the request just ends.
 */
function jsonRequest(method = "GET", path = "/", payload, headers = {}) {
    const req = new EventEmitter();
    req.method = method;
    req.url = path;
    req.headers = { ...headers };
    let sent = false;
    const on = req.on.bind(req);
    req.on = (name, listener) => {
        on(name, listener);
        if (name === "end" && !sent) {
            sent = true;
            Promise.resolve().then(() => {
                if (payload !== undefined) req.emit("data", Buffer.from(JSON.stringify(payload)));
                req.emit("end");
            });
        }
        return req;
    };
    req.destroy = jest.fn();
    return req;
}

const resolve = (value) => (typeof value === "function" ? value() : value);

/**
 * Factory mock for src/web/apiMiddleware. `user`, `fullAdmin` and `csrf` are a
 * value or a function read on every call (`() => mockUser`). A missing user or
 * a failed CSRF check is refused the way the real middleware does it: a JSON
 * 401 / 403 on `res`, and null / false back.
 */
function apiMiddlewareMock({ user = { id: "1", name: "Admin", isAdmin: true }, fullAdmin, csrf = true } = {}) {
    const { error } = jest.requireActual("../../src/web/apiResponse");
    const refuse = (res, value) => {
        if (!value && res && typeof res.writeHead === "function") error(res, 401, "unauthorized", "Nicht angemeldet.");
        return value || null;
    };
    return {
        requireAdmin: jest.fn((req, res) => refuse(res, resolve(user))),
        requireFullAdmin: jest.fn((req, res) => refuse(res, resolve(fullAdmin === undefined ? user : fullAdmin))),
        requireCsrf: jest.fn((req, res) => {
            if (resolve(csrf)) return true;
            if (res && typeof res.writeHead === "function") error(res, 403, "csrf", "Sicherheits-Token ungültig oder abgelaufen.");
            return false;
        }),
    };
}

/**
 * Factory mock for src/web/apiBody. `body` is the parsed JSON every
 * readJsonBody() resolves (a value or a function read per call); a suite
 * steers single calls with `readJsonBody.mockResolvedValue(...)`.
 */
function apiBodyMock({ body: payload = {}, raw = Buffer.alloc(0) } = {}) {
    return {
        readJsonBody: jest.fn(async () => resolve(payload)),
        readRawBody: jest.fn(async () => resolve(raw)),
    };
}

/**
 * Drives /api/* requests through the real dispatcher (apiRouter.handle), the
 * way server.js does: area gate, 404/405 and the JSON error envelope included.
 * Pass the route module under test (anything with a `routes` table) to keep a
 * suite to its own endpoints - a path another route module registers fails
 * loudly instead of quietly testing that file (an unknown path still reaches
 * the router, for the 404 cases). `handle` stays
 * available for the odd request that must bypass that check.
 *
 *   const { get, post } = routerClient(require("../../../src/web/apiRoutes/history"));
 *   const res = await post("/api/history/clear", { eventId: "e1" });
 *
 * Mutating requests carry `csrf` as their x-csrf-token header; the router is
 * required lazily, so the suite's jest.mock calls apply to it.
 */
function routerClient(routeModule, { csrf = "tok" } = {}) {
    const own = routeModule && Array.isArray(routeModule.routes)
        ? new Set(routeModule.routes.map((r) => r.path))
        : null;
    const handle = (...args) => require("../../src/web/apiRouter").handle(...args);
    const check = (pathname) => {
        if (!own || own.has(pathname)) return;
        const other = require("../../src/web/routeTable").ROUTES.find((r) => r.path === pathname);
        if (other) throw new Error(`${pathname} belongs to apiRoutes/${other.module}.js, not to the route module under test`);
    };
    const urlFor = (pathname, query) => {
        const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
        return new URL(`http://localhost${pathname}${qs}`);
    };
    async function request(method, pathname, payload, headers) {
        check(pathname);
        const req = jsonRequest(method, pathname, payload || {}, { "x-csrf-token": csrf, ...headers });
        const res = mockRes();
        await handle(pathname, req, res);
        return res;
    }
    async function get(pathname, query) {
        check(pathname);
        const res = mockRes();
        await handle(pathname, { method: "GET" }, res, urlFor(pathname, query));
        return res;
    }
    return {
        handle, urlFor, request, get,
        post: (pathname, payload, headers) => request("POST", pathname, payload, headers),
        patch: (pathname, payload, headers) => request("PATCH", pathname, payload, headers),
    };
}

module.exports = { mockRes, status, json, body, jsonRequest, apiMiddlewareMock, apiBodyMock, routerClient };
