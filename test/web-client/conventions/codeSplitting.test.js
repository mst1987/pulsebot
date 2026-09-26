// Code-splitting of the web client (#436). The whole menu used to be one
// 1.6 MB chunk that even the public plan page (/p/<token>) downloaded. Now every
// page, the shell and the public view are loaded lazily, the raidplan editor is
// a chunk of its own inside the raid detail page, and only the active language
// is fetched. There is no bundler in this test run, so the invariants are read
// from the sources: which modules are imported statically (they land in the
// same chunk) and which only through `lazy(() => import(...))`.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client");
const SRC = path.join(CLIENT, "src");
const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), "utf8");

/** The relative modules a file imports statically (type-only imports carry no code). */
function staticImports(file) {
    const src = fs.readFileSync(file, "utf8");
    const specs = [];
    for (const m of src.matchAll(/^import\s+(?!type\s)(?:[\s\S]*?\s+from\s+)?"([^"]+)";/gm)) specs.push(m[1]);
    return specs.filter((s) => s.startsWith(".")).map((s) => resolve(path.dirname(file), s)).filter(Boolean);
}

function resolve(dir, spec) {
    const base = path.join(dir, spec);
    if (/\.(css|json)$/.test(spec)) return null;
    for (const cand of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    throw new Error(`cannot resolve ${spec} from ${dir}`);
}

/** Every module reachable from `entry` through static imports — one chunk's worth. */
function staticGraph(entry) {
    const seen = new Set();
    const todo = [path.join(SRC, entry)];
    while (todo.length) {
        const file = todo.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        todo.push(...staticImports(file));
    }
    return [...seen].map((f) => path.relative(SRC, f).split(path.sep).join("/"));
}

describe("the routes are loaded lazily", () => {
    const app = read("App.tsx");

    it("imports no page and not the shell statically", () => {
        expect(app).not.toMatch(/^import [^;]*from "\.\/pages\//m);
        expect(app).not.toMatch(/^import (?!type\s)[^;]*from "\.\/components\/Shell";/m);
        expect(app).toContain("const Shell = lazy(() => import(\"./components/Shell\"));");
        expect(app).toContain("const PlanPublicPage = lazy(() => import(\"./pages/PlanPublicPage\"));");
    });

    it("has a lazy component for every page a route renders", () => {
        const rendered = new Set([...app.matchAll(/<(\w+Page) \/>/g)].map((m) => m[1]));
        expect(rendered.size).toBeGreaterThan(20);
        for (const page of rendered) {
            expect(app).toMatch(new RegExp(`const ${page} = lazy\\(\\(\\) => import\\("\\./pages/[\\w/]+"\\)\\);`));
        }
    });

    it("keeps the menu standing while a page chunk loads", () => {
        const shell = read("components/Shell.tsx");
        expect(shell).toMatch(/<Suspense fallback=\{<RaidLoader \/>\}>\s*<Outlet /);
        expect(app).toMatch(/<Suspense fallback=\{<RaidLoader text=\{t\("shell\.app\.loadingMenu"\)\} \/>\}>\s*<JobsProvider>/);
    });

    it("keeps the entry chunk free of the shell and every page", () => {
        const entry = staticGraph("main.tsx");
        expect(entry).toContain("App.tsx");
        expect(entry.filter((f) => f.startsWith("pages/"))).toEqual([]);
        expect(entry).not.toContain("components/Shell.tsx");
    });

    it("never pulls the admin menu into the public plan page", () => {
        const pub = staticGraph("pages/PlanPublicPage.tsx");
        for (const menuOnly of ["components/Shell.tsx", "App.tsx", "pages/RaidDetailPage.tsx", "pages/raid-detail/RaidplanTab.tsx"]) {
            expect(pub).not.toContain(menuOnly);
        }
    });

    it("loads the raidplan editor only when its tab is opened", () => {
        const detail = read("pages/RaidDetailPage.tsx");
        expect(detail).not.toMatch(/^import [^;]*from "\.\/raid-detail\/RaidplanTab";/m);
        expect(detail).toContain("const RaidplanTab = lazy(() => import(\"./raid-detail/RaidplanTab\"));");
        expect(staticGraph("pages/RaidDetailPage.tsx")).not.toContain("pages/raid-detail/RaidplanTab.tsx");
    });
});

describe("the libraries and the languages", () => {
    it("puts react, the router and the icons into vendor chunks", () => {
        const vite = fs.readFileSync(path.join(CLIENT, "vite.config.ts"), "utf8");
        expect(vite).toContain("manualChunks(id: string)");
        expect(vite).toContain("return \"vendor-react\";");
        expect(vite).toContain("return \"vendor-icons\";");
        for (const lib of ["react", "react-dom", "react-router-dom", "lucide-react"]) expect(vite).toContain(lib);
    });

    it("bundles only German and fetches any other language when it is chosen", () => {
        const index = read("i18n/index.ts");
        expect(index).toContain("import.meta.glob(\"./locales/de/*.json\", { eager: true, import: \"default\" })");
        expect(index).toContain("import.meta.glob([\"./locales/*/*.json\", \"!./locales/de/*.json\"], { import: \"default\" })");
        expect(index).not.toContain("import.meta.glob(\"./locales/*/*.json\", { eager: true");
        // the page waits for the chosen language instead of flashing German
        expect(read("main.tsx")).toMatch(/langReady\(\)\.then\(\(\) => \{\s*createRoot/);
        expect(read("App.tsx")).toContain("return langReady().then(() => setState({ status: \"ready\", session }));");
    });

    it("switches only once the language is loaded, and the last choice wins", () => {
        const index = read("i18n/index.ts");
        expect(index).toMatch(/if \(wanted !== lang \|\| lang === current \|\| !loaded\.has\(lang\)\) return;/);
        expect(index).toMatch(/wanted = lang;\s*\n\s*if \(lang === current\) return;\s*\n\s*switchToWanted\(\);/);
    });
});
