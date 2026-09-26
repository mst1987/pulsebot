// Every backend module is loaded by at least one test (#434). CLAUDE.md used to
// promise "every module has a matching test"; in truth 26 modules were only
// ever reached through something else, and a module no test loads is a module
// whose breakage nobody notices. So: each src/**/*.js (without the React client
// and bot.js, which coverage leaves out too) must be `require`d - or loaded with
// jest.requireActual - by some file under test/, found statically in the test
// sources. A `jest.mock("…")` path does not count: mocking a module is the
// opposite of testing it.
//
// The exceptions stand in ALLOWED with their reason: pure data tables, which a
// test of the code that reads them already covers, and files a test loads
// through a computed path this scan cannot follow. An entry that is no longer
// needed (the module is loaded after all, or gone) fails too, so the list only
// ever shrinks.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const TEST = path.join(ROOT, "test");

const ALLOWED = {
    // pure data tables, covered by the tests of the module that reads them
    "src/config/profanity.js": "reine Wortlisten, geprüft über utils/signup/characterNames.js (characterNames.test.js)",
    "src/config/recommendationRules.js": "reine Regeltabelle, geprüft über utils/logcheck/recommendations.js",
    "src/config/softresInstances.js": "reine Instanz-Tabelle, geprüft über utils/loot/softres.js (softres.test.js)",
    "src/web/raidplanConstants.js": "zwei Konstanten-Listen, geprüft über raidplanAssign/raidplanCatalogStore/raidplanTitle",
    // loaded through a computed path
    "src/web/static/report.js": "Browser-Skript; test/web/static/report.test.js lädt es über path.join",
};

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return [full];
    });
}
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

/** The backend modules: src/**\/*.js without the React client and the bot entry point. */
function sourceModules() {
    return walk(SRC)
        .filter((f) => f.endsWith(".js"))
        .map(rel)
        .filter((f) => !f.startsWith("src/web-client/") && f !== "src/bot.js")
        .sort();
}

function resolveFrom(file, request) {
    const base = path.resolve(path.dirname(file), request);
    for (const candidate of [base, `${base}.js`, path.join(base, "index.js")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return rel(candidate);
    }
    return null;
}

/** Every file a test source loads for real: require()/jest.requireActual() with a literal relative path. */
function loadedFrom(source, file) {
    const text = source
        // the path a jest.mock names is replaced, not loaded
        .replace(/jest\.(?:mock|doMock|unmock|setMock|dontMock)\(\s*(["'`])[^"'`]*\1/g, "");
    const loaded = [];
    const re = /(?:\brequire|jest\.requireActual)\(\s*(["'`])([^"'`$]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
        if (!m[2].startsWith(".")) continue;
        const target = resolveFrom(file, m[2]);
        if (target) loaded.push(target);
    }
    return loaded;
}

const loadedBy = (file) => loadedFrom(fs.readFileSync(file, "utf8"), file);

function loadedModules() {
    const loaded = new Set();
    for (const file of walk(TEST).filter((f) => f.endsWith(".js"))) {
        for (const target of loadedBy(file)) loaded.add(target);
    }
    return loaded;
}

describe("every backend module is loaded by a test", () => {
    const modules = sourceModules();
    const loaded = loadedModules();

    it("finds the modules and the loads at all", () => {
        expect(modules.length).toBeGreaterThan(300);
        expect(loaded.has("src/web/apiRouter.js")).toBe(true);
    });

    it("loads every module outside the allowlist", () => {
        const missing = modules.filter((m) => !loaded.has(m) && !ALLOWED[m]);
        // A module listed here needs a test that requires it (test/<same path>.test.js,
        // for routes test/web/apiRoutes/<name>.test.js) - or, if it is a pure data
        // table, an entry with its reason in ALLOWED above.
        expect(missing).toEqual([]);
    });

    it("keeps the allowlist to modules that still need it", () => {
        const stale = Object.keys(ALLOWED).filter((m) => !modules.includes(m) || loaded.has(m));
        expect(stale).toEqual([]);
    });

    it("gives every exception a reason", () => {
        for (const [file, reason] of Object.entries(ALLOWED)) {
            expect({ file, reason: reason.length > 10 }).toEqual({ file, reason: true });
        }
    });

    it("does not count a mocked path as loaded", () => {
        const file = path.join(TEST, "docs", "example.test.js");
        expect(loadedFrom("jest.mock(\"../../src/web/raidplanConstants\", () => ({}));", file)).toEqual([]);
        expect(loadedFrom("jest.requireActual(\"../../src/web/raidplanConstants\");", file)).toEqual(["src/web/raidplanConstants.js"]);
        expect(loadedFrom("require(\"../../src/web/raidplanConstants.js\");", file)).toEqual(["src/web/raidplanConstants.js"]);
    });
});
