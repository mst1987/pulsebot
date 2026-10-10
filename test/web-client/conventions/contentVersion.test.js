// The web shows one game version at a time (#741, decision on #736: strictly
// separated). Every page of the menu either follows the content switch, or is on
// the one list of version-neutral pages: menu.json's `neutral` entries, the pages
// without game content (Kanäle, Einstellungen, Systemstatus).
//
// "Follows" means the page (or one of its own parts under pages/) reads the
// version with hooks/useContentVersion, or shows one record in its version with
// hooks/useFollowVersion (a raid, a Kader, a roster, a character). A new page
// that does neither fails here, so no list mixes versions by accident; the
// server answers one version per list anyway (mainVersion.resolveVersionQuery).
const fs = require("fs");
const path = require("path");
const { read } = require("../clientSource");

const SRC = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const MENU = require("../../../src/config/menu.json");

// Pages that neither follow nor are neutral yet — each with its reason. An entry
// here is a decision, not a convenience: a page with game content belongs on it
// only while the issue that moves it is open.
const NOT_YET = {
    // Aufruf-Vorlagen: version-free text templates, decision pending (plain message texts with
    // placeholders, the same for every version; no raid, class or item in them)
    "raids/templates": "version-free text templates, decision pending",
};

/** The relative modules a file imports statically (type-only imports carry no code). */
function staticImports(file) {
    const src = fs.readFileSync(file, "utf8");
    const specs = [];
    for (const m of src.matchAll(/^import\s+(?!type\s)(?:[\s\S]*?\s+from\s+)?"([^"]+)";/gm)) specs.push(m[1]);
    return specs.filter((s) => s.startsWith(".") && !/\.(css|json)$/.test(s)).map((s) => resolve(path.dirname(file), s)).filter(Boolean);
}

function resolve(dir, spec) {
    const base = path.join(dir, spec);
    for (const cand of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return null;
}

/** The page file and the parts under pages/ it reaches through static imports. */
function pageModules(entry) {
    const pages = path.join(SRC, "pages");
    const seen = new Set();
    const todo = [entry];
    while (todo.length) {
        const file = todo.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        for (const next of staticImports(file)) if (next.startsWith(pages)) todo.push(next);
    }
    return [...seen];
}

/** Whether a page reads the content version: useContentVersion(), or useFollowVersion() for one record. */
function followsVersion(entry) {
    return pageModules(entry).some((file) => /\buse(ContentVersion|FollowVersion)\(/.test(fs.readFileSync(file, "utf8")));
}

/** Every route inside the shell: its path and the lazily loaded page it renders. */
function shellRoutes() {
    const app = read("App.tsx");
    const lazy = new Map([...app.matchAll(/const (\w+) = lazyWithReload\(\(\) => import\("\.\/([^"]+)"\)\);/g)].map((m) => [m[1], m[2]]));
    const routes = [];
    for (const m of app.matchAll(/<Route\s+(index|path="([^"]*)")\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
        const routePath = m[1] === "index" ? "" : m[2];
        const pages = [...m[3].matchAll(/<(\w+Page)\b/g)].map((x) => x[1]).filter((name) => lazy.has(name));
        for (const page of pages) routes.push({ path: routePath, page, file: resolve(SRC, `./${lazy.get(page)}`) });
    }
    return routes;
}

/** Whether a route path belongs to a menu entry marked neutral (its own page or one under it). */
function isNeutral(routePath) {
    const p = `/${routePath}`.replace(/\/:.*$/, "");
    return MENU.some((e) => e.neutral === true && (p === e.href || p.startsWith(`${e.href}/`)));
}

describe("one game version per page (#741)", () => {
    const routes = shellRoutes();

    it("finds the shell's pages", () => {
        // a sanity check of the parser: the start page, the raid detail and the settings are among them
        expect(routes.map((r) => r.page)).toEqual(expect.arrayContaining(["DashboardPage", "RaidDetailPage", "SettingsPage", "KaderPage"]));
        expect(routes.length).toBeGreaterThan(25);
        for (const r of routes) expect({ page: r.page, file: !!r.file }).toEqual({ page: r.page, file: true });
    });

    it("keeps the one list of neutral pages in menu.json: Kanäle, Einstellungen, Systemstatus", () => {
        expect(MENU.filter((e) => e.neutral === true).map((e) => e.id).sort()).toEqual(["channels", "settings", "system"]);
    });

    it("lets every other page follow the content switch", () => {
        const missing = routes
            .filter((r) => !isNeutral(r.path) && !NOT_YET[r.path] && !followsVersion(r.file))
            .map((r) => `${r.path || "/"} (${r.page})`);
        expect(missing).toEqual([]);
    });

    it("lists only real routes as not yet following", () => {
        const known = new Set(routes.map((r) => r.path));
        for (const p of Object.keys(NOT_YET)) expect({ p, known: known.has(p) }).toEqual({ p, known: true });
    });

    it("shows no version state on a neutral page", () => {
        expect(read("components/shell/Shell.tsx")).toMatch(/\{!tab\?\.neutral && <ContentSwitch \/>\}/);
    });

    it("offers no 'Alle' in the switch and never asks the server for every version", () => {
        expect(read("components/shell/ContentSwitch.tsx")).not.toMatch(/"all"/);
        const asking = [];
        for (const file of fs.readdirSync(path.join(SRC, "api"))) {
            const src = fs.readFileSync(path.join(SRC, "api", file), "utf8");
            if (/version=all|set\("version",\s*"all"\)|version:\s*"all"/.test(src)) asking.push(file);
        }
        expect(asking).toEqual([]);
    });
});
