const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { tempStoreFile } = require("../helpers/tempStore");
const { planMove, expandMapping } = require("../../scripts/lib/moveFiles");
const { run } = require("../../scripts/move-files");

/** A plan over files given as { path: content } (null = a file that is not read, e.g. an image). */
function plan(tree, mapping, options) {
    const files = Object.keys(tree);
    const contents = new Map(Object.entries(tree).filter(([, c]) => c !== null));
    const result = planMove(files, contents, mapping, options);
    return { ...result, moved: Object.fromEntries(result.moves), out: Object.fromEntries(result.writes) };
}

describe("expandMapping", () => {
    const files = ["src/a/x.js", "src/a/y.js", "src/b.js"];

    test("a file, a file into a folder, a whole folder", () => {
        expect([...expandMapping({ "src/b.js": "src/c.js" }, files)]).toEqual([["src/b.js", "src/c.js"]]);
        expect([...expandMapping({ "src/b.js": "src/a/" }, files)]).toEqual([["src/b.js", "src/a/b.js"]]);
        expect([...expandMapping({ "src/a/": "src/z" }, files)]).toEqual([["src/a/x.js", "src/z/x.js"], ["src/a/y.js", "src/z/y.js"]]);
    });

    test("an unknown source is an error", () => {
        expect(() => expandMapping({ "src/nope.js": "src/x.js" }, files)).toThrow(/weder Datei noch Ordner/);
    });
});

describe("planMove - relative paths", () => {
    test("a require of a moved module is rewritten, with and without extension", () => {
        const { out } = plan({
            "src/stores/eventStore.js": "module.exports = 1;\n",
            "src/services/x.js": "require(\"../stores/eventStore\");\nrequire(\"../stores/eventStore.js\");\n",
        }, { "src/stores/eventStore.js": "src/stores/events/" });
        expect(out["src/services/x.js"]).toBe("require(\"../stores/events/eventStore\");\nrequire(\"../stores/events/eventStore.js\");\n");
    });

    test("the imports inside a moved file follow its new place", () => {
        const { out } = plan({
            "src/lib/a.ts": "import { b } from \"./b\";\nimport c from \"../c/index\";\nimport \"../styles/x.css\";\n",
            "src/lib/b.ts": "",
            "src/c/index.ts": "",
            "src/styles/x.css": "",
        }, { "src/lib/a.ts": "src/lib/deep/" });
        expect(out["src/lib/deep/a.ts"]).toBe("import { b } from \"../b\";\nimport c from \"../../c/index\";\nimport \"../../styles/x.css\";\n");
    });

    test("a folder import keeps pointing at the folder; an index file moving changes it", () => {
        const { out } = plan({
            "src/ui/index.ts": "",
            "src/ui/Button.tsx": "",
            "src/pages/P.tsx": "import { Button } from \"../ui\";\nimport B from \"../ui/Button\";\n",
        }, { "src/pages/P.tsx": "src/pages/sub/" });
        expect(out["src/pages/sub/P.tsx"]).toBe("import { Button } from \"../../ui\";\nimport B from \"../../ui/Button\";\n");
    });

    test("jest.mock, vi.mock and requireActual are followed like require", () => {
        const { out } = plan({
            "src/stores/s.js": "",
            "test/stores/s.test.js": "jest.mock(\"../../src/stores/s\");\njest.requireActual(\"../../src/stores/s\");\n",
            "web/lib/a.ts": "",
            "web/lib/a.test.ts": "vi.mock(\"./a\");\nimport { a } from \"./a\";\n",
        }, { "src/stores/s.js": "src/stores/sub/", "web/lib/a.test.ts": "web/lib/__tests__/" });
        expect(out["test/stores/s.test.js"]).toBe("jest.mock(\"../../src/stores/sub/s\");\njest.requireActual(\"../../src/stores/sub/s\");\n");
        expect(out["web/lib/__tests__/a.test.ts"]).toBe("vi.mock(\"../a\");\nimport { a } from \"../a\";\n");
    });

    test("a bare \".\" or \"..\" naming a module follows the move; split(\".\") stays", () => {
        const { out } = plan({
            "web/i18n/index.ts": "",
            "web/i18n/x.test.ts": "import { t } from \".\";\nvi.mock(\"..\");\nconst p = \"a.b\".split(\".\");\n",
            "web/index.ts": "",
        }, { "web/i18n/x.test.ts": "web/i18n/__tests__/" });
        expect(out["web/i18n/__tests__/x.test.ts"]).toBe("import { t } from \"..\";\nvi.mock(\"../..\");\nconst p = \"a.b\".split(\".\");\n");
    });

    test("a folder path in a moved file is rewritten for the new depth", () => {
        const { out } = plan({
            "src/web-client/src/x.ts": "",
            "test/conv/a.test.js": "const root = path.join(__dirname, \"../../src/web-client/src\");\n",
        }, { "test/conv/a.test.js": "test/conv/raidplan/" });
        expect(out["test/conv/raidplan/a.test.js"]).toBe("const root = path.join(__dirname, \"../../../src/web-client/src\");\n");
    });

    test("Markdown links are followed; unrelated and unresolvable paths stay", () => {
        const { out, writes } = plan({
            "src/stores/s.js": "",
            "docs/a.md": "See [s](../src/stores/s.js) and ../eventhelper-<name>/ and ../../x.\n",
            "src/other.js": "require(\"./nothing\"); require(\"react-dom/client\"); path.join(__dirname, \"../..\");\n",
        }, { "src/stores/s.js": "src/stores/sub/" });
        expect(out["docs/a.md"]).toBe("See [s](../src/stores/sub/s.js) and ../eventhelper-<name>/ and ../../x.\n");
        expect(writes.has("src/other.js")).toBe(false);
    });
});

describe("planMove - repository paths and tails", () => {
    test("full repository paths in any text file, without extension only in code", () => {
        const { out } = plan({
            "src/stores/s.js": "",
            "docs/d.md": "`src/stores/s.js` holds it. And src/stores/s too.\n",
            "test/t.test.js": "const f = \"src/stores/s\";\n",
        }, { "src/stores/s.js": "src/stores/sub/" });
        expect(out["docs/d.md"]).toBe("`src/stores/sub/s.js` holds it. And src/stores/s too.\n");
        expect(out["test/t.test.js"]).toBe("const f = \"src/stores/sub/s\";\n");
    });

    test("a unique tail with an extension is rewritten below the same root", () => {
        const { out } = plan({
            "src/web-client/src/lib/raidplan/assign.ts": "",
            "test/conv/a.test.js": "read(\"lib/raidplan/assign.ts\"); // lib/raidplan/assign.ts.\n",
        }, { "src/web-client/src/lib/raidplan/assign.ts": "src/web-client/src/lib/raidplan/assign/" });
        expect(out["test/conv/a.test.js"]).toBe("read(\"lib/raidplan/assign/assign.ts\"); // lib/raidplan/assign/assign.ts.\n");
    });

    test("an ambiguous tail and a path in a longer path or URL stay", () => {
        const { writes } = plan({
            "a/x/y.ts": "",
            "b/x/y.ts": "",
            "src/s.js": "",
            "docs/d.md": "x/y.ts and https://example.com/src/s.js and foo/src/s.js\n",
        }, { "a/x/y.ts": "a/z/y.ts", "src/s.js": "src/n/s.js" });
        expect(writes.has("docs/d.md")).toBe(false);
    });

    test("a tail whose file leaves its root is reported, not guessed", () => {
        const { warnings, writes } = plan({
            "web/src/lib/a.ts": "",
            "test/c.test.js": "read(\"lib/a.ts\");\n",
        }, { "web/src/lib/a.ts": "other/a.ts" });
        expect(writes.has("test/c.test.js")).toBe(false);
        expect(warnings[0]).toMatch(/test\/c\.test\.js: "lib\/a\.ts" zeigt auf web\/src\/lib\/a\.ts/);
    });
});

describe("planMove - tests and checks", () => {
    test("--mirror-tests moves the Jest tests of backend modules along", () => {
        const { moved } = plan({
            "src/stores/eventStore.js": "",
            "test/stores/eventStore.test.js": "",
            "test/stores/eventStore.series.test.js": "",
            "test/stores/eventStoreX.test.js": "",
            "src/web-client/src/a.js": "",
            "test/web-client/src/a.test.js": "",
        }, { "src/stores/eventStore.js": "src/stores/events/", "src/web-client/src/a.js": "src/web-client/src/b/" }, { mirrorTests: true });
        expect(moved).toEqual({
            "src/stores/eventStore.js": "src/stores/events/eventStore.js",
            "src/web-client/src/a.js": "src/web-client/src/b/a.js",
            "test/stores/eventStore.test.js": "test/stores/events/eventStore.test.js",
            "test/stores/eventStore.series.test.js": "test/stores/events/eventStore.series.test.js",
        });
    });

    test("--mirror-tests moves the __tests__ of client modules along", () => {
        const { moved } = plan({
            "src/web-client/src/lib/rp/assign.ts": "",
            "src/web-client/src/lib/rp/__tests__/assign.test.ts": "",
            "src/web-client/src/lib/rp/__tests__/assign.prio.test.tsx": "",
            "src/web-client/src/lib/rp/__tests__/assignLine.test.ts": "",
            "src/web-client/src/lib/rp/__tests__/rp.boards.test.ts": "",
        }, { "src/web-client/src/lib/rp/assign.ts": "src/web-client/src/lib/rp/assign/" }, { mirrorTests: true });
        expect(moved).toEqual({
            "src/web-client/src/lib/rp/assign.ts": "src/web-client/src/lib/rp/assign/assign.ts",
            "src/web-client/src/lib/rp/__tests__/assign.test.ts": "src/web-client/src/lib/rp/assign/__tests__/assign.test.ts",
            "src/web-client/src/lib/rp/__tests__/assign.prio.test.tsx": "src/web-client/src/lib/rp/assign/__tests__/assign.prio.test.tsx",
        });
    });

    test("a target that is taken, or taken twice, is an error", () => {
        expect(() => plan({ "a.js": "", "b.js": "" }, { "a.js": "b.js" })).toThrow(/schon eine Datei/);
        expect(() => plan({ "a/x.js": "", "b/x.js": "" }, { "a/x.js": "c/", "b/x.js": "c/" })).toThrow(/zwei Dateien/);
        expect(() => plan({ "a.js": "", "b.js": "" }, { "a.js": "b.js", "b.js": "c.js" })).not.toThrow();
    });

    test("a moved file nobody points at only moves", () => {
        const { moves, writes } = plan({ "src/a.js": "module.exports = 1;\n", "img/x.png": null }, { "src/a.js": "src/b/" });
        expect(moves).toEqual([["src/a.js", "src/b/a.js"]]);
        expect(writes.size).toBe(0);
    });
});

describe("move-files CLI", () => {
    let root;
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const write = (file, content) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    };

    beforeEach(() => {
        root = path.dirname(tempStoreFile("repo.json"));
        git("init", "-q");
        write("src/stores/s.js", "module.exports = 1;\n");
        write("src/use.js", "require(\"./stores/s\");\n");
        write("assets/a.png", "binary");
        git("add", ".");
        // untracked, like a mapping in the scratchpad: it is not rewritten itself
        write("map.json", JSON.stringify({ "src/stores/s.js": "src/stores/sub/" }));
    });

    test("--dry prints the plan and touches nothing", () => {
        const lines = [];
        run(["map.json", "--dry"], root, (l) => lines.push(l));
        expect(lines).toEqual(["src/stores/s.js -> src/stores/sub/s.js", "1 Dateien verschoben, 1 Dateien angepasst"]);
        expect(fs.existsSync(path.join(root, "src/stores/s.js"))).toBe(true);
    });

    test("moves, rewrites and removes the folder left empty", () => {
        write("map.json", JSON.stringify({ "src/stores/": "src/data/" }));
        run(["map.json"], root, () => {});
        expect(fs.readFileSync(path.join(root, "src/use.js"), "utf8")).toBe("require(\"./data/s\");\n");
        expect(fs.existsSync(path.join(root, "src/data/s.js"))).toBe(true);
        expect(fs.existsSync(path.join(root, "src/stores"))).toBe(false);
    });

    test("without a mapping it says how to call it", () => {
        expect(() => run([], root, () => {})).toThrow(/Aufruf/);
    });
});
