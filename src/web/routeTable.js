// The one table of every /api/* route: each apiRoutes/*.js exports `routes`,
// this module collects them, and both the dispatcher (apiRouter.js) and the
// area gate (apiAccess.js) read from here — so a path can no longer be
// registered in one place and forgotten in the other.
//
// An entry is `{ method, path, handler, area | auth | adminOnly, level? }`:
//   area      the menu area(s) that open it (one id or a list; any one at the
//             required level lets the call through); the level follows the
//             method — GET reads, everything else writes — unless `level` says so
//   auth      "none"  — answers for anyone (session bootstrap, the public raid plan)
//             "menu"  — any menu user, whatever area (the guild switcher)
//             "token" — bearer-token endpoints; the handler checks the token itself
//   adminOnly an entry that belongs to no area on purpose: full admins only
// An entry with none of these is admin-only too (fail-closed), and a test keeps
// that state explicit (test/web/apiAccess.test.js).
//
// Paths are exact; the /api layer carries its parameters in the query and the
// body (`/api/raids/detail?event=<id>`), never in the path.
const MODULES = [
    "session", "dashboard", "version", "channels", "settings", "talkOverview", "raidhelperRetirement",
    "ingest", "botCommands", "raiderCharacters", "roster", "profile", "signups", "lootCouncil",
    "raids", "raidDetail", "setup", "raidplan", "eventManage", "eventSeries", "gameVersions",
    "notifyTemplates", "raidTemplates", "recruitment", "history", "cla",
];

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Collects and checks the tables; a bad entry is a programming error and fails at load. */
function collect(modules) {
    const routes = [];
    const seen = new Set();
    for (const name of modules) {
        const mod = require(`./apiRoutes/${name}`);
        if (!Array.isArray(mod.routes)) throw new Error(`apiRoutes/${name}.js exports no routes table`);
        for (const r of mod.routes) {
            if (!r || !METHODS.has(r.method)) throw new Error(`apiRoutes/${name}.js: bad method on ${r && r.path}`);
            if (typeof r.path !== "string" || !r.path.startsWith("/api/")) throw new Error(`apiRoutes/${name}.js: bad path ${r.path}`);
            if (typeof r.handler !== "function") throw new Error(`apiRoutes/${name}.js: ${r.method} ${r.path} has no handler`);
            const key = `${r.method} ${r.path}`;
            if (seen.has(key)) throw new Error(`route registered twice: ${key}`);
            seen.add(key);
            routes.push(Object.freeze({ ...r, module: name }));
        }
    }
    return routes;
}

const ROUTES = Object.freeze(collect(MODULES));
const BY_KEY = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r]));
const METHODS_BY_PATH = new Map();
for (const r of ROUTES) {
    if (!METHODS_BY_PATH.has(r.path)) METHODS_BY_PATH.set(r.path, []);
    METHODS_BY_PATH.get(r.path).push(r.method);
}

/** The route for a method and path, or null. */
const find = (method, pathname) => BY_KEY.get(`${method} ${pathname}`) || null;

/** The methods a path answers to (empty for an unknown path). */
const methodsFor = (pathname) => METHODS_BY_PATH.get(pathname) || [];

/** The areas an entry names, always as an array (empty = none). */
function areasOf(route) {
    if (!route || !route.area) return [];
    return Array.isArray(route.area) ? route.area : [route.area];
}

module.exports = { ROUTES, MODULES, find, methodsFor, areasOf };
