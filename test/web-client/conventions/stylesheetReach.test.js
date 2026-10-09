// A component's classes must be loaded on every page that renders it.
//
// A module stylesheet (styles/<module>.css) only reaches the browser with the
// chunk of the module that imports it, and every page is its own lazy chunk
// (codeSplitting.test.js). A component that is rendered on two pages but whose
// classes live in the stylesheet of only one of them works as long as somebody
// visits that page first — and is bare when the other page is opened directly.
// That is how the "Event bearbeiten" dialog on the raid detail page showed its
// step bar as a plain numbered list ("1. 1Date"): RaidCreateDialog's classes
// were in raid-events.css, which only RaidsPage imported.
//
// The rule read from the sources: for every page (a lazy route of App.tsx, and
// a lazy part inside a page, like the raid plan tab), every module-stylesheet
// class a module of its static import graph names must be defined by a
// stylesheet in that graph (or in the shared layer index.css loads for all).
// The scan is per file, not per export: ALLOWED lists the files whose export
// that needs the class is only rendered where the stylesheet is loaded.
const fs = require("fs");
const path = require("path");
const { CLIENT, stripComments, isTestFile } = require("../clientSource");

const STYLES = path.join(CLIENT, "styles");
const SHARED_FILES = ["tokens.css", "base.css", "shared.css", "feedback.css", "loot.css", "ui.css"];

// [file, stylesheet, why the page-level miss is not a real one]
const ALLOWED = [
    ["components/character/ClassSpec.tsx", "styles/roster-character.css", "only ClassSpecIdentity uses spec-ident-*, and only the roster renders it"],
    ["components/loot/LootBadges.tsx", "styles/history-loot.css", "only ItemIcon/StackBar use hl-ico/hl-stack, rendered by the history pages alone"],
];

const rel = (abs) => path.relative(CLIENT, abs).split(path.sep).join("/");

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** The selectors of a stylesheet (everything before a `{`), comments dropped. */
function selectors(css) {
    return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{};]*)\{/g)].map((m) => m[1]);
}
const CLASS = /\.([a-z][\w]*-[\w-]+)/g;

/** class name -> the module stylesheets that style it; shared-layer classes are left out. */
function moduleClasses() {
    const shared = new Set();
    for (const f of SHARED_FILES) {
        for (const sel of selectors(fs.readFileSync(path.join(STYLES, f), "utf8"))) for (const m of sel.matchAll(CLASS)) shared.add(m[1]);
    }
    const map = new Map();
    for (const file of walk(STYLES).filter((f) => f.endsWith(".css"))) {
        if (path.dirname(file) === STYLES && SHARED_FILES.includes(path.basename(file))) continue;
        for (const sel of selectors(fs.readFileSync(file, "utf8"))) {
            for (const m of sel.matchAll(CLASS)) {
                if (shared.has(m[1])) continue;
                if (!map.has(m[1])) map.set(m[1], new Set());
                map.get(m[1]).add(rel(file));
            }
        }
    }
    return map;
}

function resolve(from, spec) {
    if (!spec.startsWith(".")) return null;
    const base = path.resolve(path.dirname(from), spec);
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return null;
}

/** Static imports (and a stylesheet's @imports) — what lands in the same chunk. */
function staticImports(file) {
    const src = fs.readFileSync(file, "utf8");
    const specs = file.endsWith(".css")
        ? [...src.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1])
        : [...src.matchAll(/^(?:import|export)\s+(?!type\s)(?:[^;"]*?\sfrom\s+)?"([^"]+)";/gm)].map((m) => m[1]);
    return specs.map((s) => resolve(file, s)).filter(Boolean);
}

/** Lazy parts a file loads: `lazyWithReload(() => import("./x"))`. */
function lazyImports(file) {
    if (file.endsWith(".css")) return [];
    const src = fs.readFileSync(file, "utf8");
    return [...src.matchAll(/import\("([^"]+)"\)/g)].map((m) => resolve(file, m[1])).filter(Boolean);
}

function graph(entries) {
    const seen = new Set();
    const todo = [...entries];
    while (todo.length) {
        const f = todo.pop();
        if (seen.has(f) || isTestFile(f)) continue;
        seen.add(f);
        todo.push(...staticImports(f));
    }
    return seen;
}

/** The class names a source file names in its string literals. */
function namedClasses(file, known) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const out = new Set();
    for (const m of src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
        for (const tok of (m[1] ?? m[2] ?? m[3]).split(/[\s${}]+/)) if (known.has(tok)) out.add(tok);
    }
    return out;
}

/** Every page context: [name, the modules loaded when it is open]. */
function pageContexts() {
    const main = path.join(CLIENT, "main.tsx");
    const app = path.join(CLIENT, "App.tsx");
    const shell = path.join(CLIENT, "components", "shell", "Shell.tsx");
    const base = graph([main]);
    const contexts = [];
    const visit = (entry, loaded) => {
        const files = new Set([...loaded, ...graph([entry])]);
        contexts.push([rel(entry), files]);
        for (const f of graph([entry])) for (const lazy of lazyImports(f)) visit(lazy, files);
    };
    for (const page of lazyImports(app)) {
        if (page === shell) continue;
        // the public plan page renders without the menu shell, every other page inside it
        const loaded = page.endsWith("PlanPublicPage.tsx") ? base : new Set([...base, ...graph([shell])]);
        visit(page, loaded);
    }
    return contexts;
}

describe("a component's stylesheet is loaded wherever it is rendered", () => {
    const classes = moduleClasses();
    const known = new Set(classes.keys());
    const contexts = pageContexts();

    it("finds the pages and their stylesheets", () => {
        expect(contexts.length).toBeGreaterThan(20);
        const detail = contexts.find(([name]) => name === "pages/raid-detail/RaidDetailPage.tsx");
        expect(detail).toBeDefined();
        expect([...detail[1]].map(rel)).toContain("styles/raid-detail.css");
        expect(contexts.map(([name]) => name)).toContain("pages/raid-detail/RaidplanTab.tsx");
        expect(classes.get("re-steps")).toEqual(new Set(["styles/raid-events.css"]));
    });

    it("loads the create/edit dialog's stylesheet on the raid detail page", () => {
        const [, files] = contexts.find(([name]) => name === "pages/raid-detail/RaidDetailPage.tsx");
        const names = [...files].map(rel);
        expect(names).toContain("components/raid-create/RaidCreateDialog.tsx");
        expect(names).toContain("styles/raid-events.css");
    });

    it("never leaves a class bare on a page that renders it", () => {
        const allowed = new Set(ALLOWED.map(([file, css]) => `${file} -> ${css}`));
        const misses = new Set();
        for (const [page, files] of contexts) {
            const loaded = new Set([...files].filter((f) => f.endsWith(".css")).map(rel));
            for (const file of files) {
                if (file.endsWith(".css")) continue;
                for (const cls of namedClasses(file, known)) {
                    const sheets = [...classes.get(cls)];
                    if (sheets.some((s) => loaded.has(s))) continue;
                    const key = `${rel(file)} -> ${sheets.join(" | ")}`;
                    if (!allowed.has(key)) misses.add(`${page}: .${cls} of ${key}`);
                }
            }
        }
        expect([...misses].sort()).toEqual([]);
    });

    it("keeps every allowance in use", () => {
        for (const [file, css] of ALLOWED) {
            expect(fs.existsSync(path.join(CLIENT, file))).toBe(true);
            const named = namedClasses(path.join(CLIENT, file), known);
            expect({ file, styled: [...named].some((c) => classes.get(c).has(css)) }).toEqual({ file, styled: true });
        }
    });
});
