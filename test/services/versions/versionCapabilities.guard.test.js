// Guard (#761): what a game version can do is decided in one place,
// services/versions/versionCapabilities.js, from data (the rule sets, the log
// rule sets, the version settings, the catalog). No module keeps its own list of
// versions for a feature any more (LOGCHECK_VERSIONS, the council's CONTENT map,
// ASSIGN_TYPE_VERSIONS, the guild bank's FALLBACK_PATH), and the raw checks
// behind the features are asked by the source alone.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "..", "src");
const SKIP_DIRS = new Set(["web-client", "node_modules"]);
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : jsFiles(full);
        return entry.name.endsWith(".js") ? [full] : [];
    });
}

// Where per-version data belongs: the rule sets, the log check's rule sets, the
// catalog's entries (each names its versions) and the source itself.
const DATA_HOMES = new Set([
    "services/versions/versionCapabilities.js",
    "utils/logcheck/rules.js",
    "services/raidplan/raidplanCatalogDefaults.js",
]);
const isDataHome = (r) => r.startsWith("config/gameVersions/") || DATA_HOMES.has(r);

const VERSION = "(?:tbc|classic|forever)";
// `tbc: { … }`, `forever: [ … ]`, `classic: true` — a map keyed by version that switches something
const KEYED = new RegExp(`(?:^|[\\s{,])${VERSION}\\s*:\\s*(?:\\{|\\[|true\\b|false\\b)`);
// `md: ["tbc"]` — a list of versions as a value
const LISTED = new RegExp(`:\\s*\\[\\s*"${VERSION}"(?:\\s*,\\s*"${VERSION}")*\\s*\\]`);

/** The code lines of a file (comment lines left out). */
function codeLines(file) {
    return fs.readFileSync(file, "utf8").split(/\r?\n/)
        .map((text, i) => ({ text, line: i + 1 }))
        .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

describe("one source for what a version can do (#761)", () => {
    const files = jsFiles(SRC);

    it("finds the patterns it looks for", () => {
        expect(KEYED.test("const LOGCHECK_VERSIONS = { tbc: { apiSite: X } };")).toBe(true);
        expect(KEYED.test("const CONTENT = {\n    forever: [\"a\"] };")).toBe(true);
        expect(LISTED.test("const ASSIGN_TYPE_VERSIONS = { md: [\"tbc\"] };")).toBe(true);
        expect(KEYED.test("const FALLBACK = { tbc: \"tbc\" };")).toBe(false);
        expect(files.length).toBeGreaterThan(300);
    });

    it("keeps no list of versions for a feature outside the source and the data", () => {
        const found = [];
        for (const file of files) {
            const r = rel(file);
            if (isDataHome(r)) continue;
            for (const { text, line } of codeLines(file)) {
                if (KEYED.test(text) || LISTED.test(text)) found.push(`${r}:${line}: ${text.trim()}`);
            }
        }
        expect(found).toEqual([]);
    });

    it("lets only the source ask the raw checks behind the features", () => {
        const RAW = [/\bhasSheetLayout\(/, /\.councilContent\b/, /\blogcheckRules\([^)]*\)\.ready\b/, /\brules\.ready\b/];
        const ALLOWED = new Set(["services/versions/versionCapabilities.js", "config/gameVersions/index.js", "utils/logcheck/rules.js"]);
        const found = [];
        for (const file of files) {
            const r = rel(file);
            if (ALLOWED.has(r)) continue;
            for (const { text, line } of codeLines(file)) {
                if (RAW.some((re) => re.test(text))) found.push(`${r}:${line}: ${text.trim()}`);
            }
        }
        expect(found).toEqual([]);
    });

    it("has the old per-feature lists gone for good", () => {
        const names = /\b(LOGCHECK_VERSIONS|ASSIGN_TYPE_VERSIONS|FALLBACK_PATH)\b/;
        const found = files.filter((f) => names.test(fs.readFileSync(f, "utf8"))).map(rel);
        expect(found).toEqual([]);
        expect(fs.existsSync(path.join(SRC, "config", "councilContent.js"))).toBe(false);
    });
});
