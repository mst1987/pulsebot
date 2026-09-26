// The module stylesheets all end up in ONE bundle, so a class name is only a
// namespace as long as exactly one module uses it.
//
// This test exists because three modules had settled on the prefix "rc-":
// Recruitment (rc-row = a table row), Roster & Charakter (rc-row = a CSS grid
// with eight fixed columns) and the raider-character list in the settings. The
// grid won in the bundle, and the Recruitment table's rows were laid out by the
// roster's column widths — the channel name sat in a 34 px column and was cut
// off. Nothing in either module was wrong on its own, which is exactly why it
// took a screenshot to find.
const fs = require("fs");
const path = require("path");

const STYLES = path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "styles");

// The shared layer index.css imports (#441): variables, base, the page pieces
// several modules share, feedback, shared loot pieces, the ui building blocks.
// Every page loads it, so it is not a module; its classes are the shared ones.
const SHARED_FILES = ["tokens.css", "base.css", "shared.css", "feedback.css", "loot.css", "ui.css"];

// Classes the shared building blocks own (the shared layer). A module may re-style them
// for its own page — always from its own scope, e.g. ".hl-card .part-head" —
// so they turn up in several files by design.
const SHARED = new Set([
    "page-head", "part-head", "ph-act", "ph-text", "dlg-head", "dlg-title", "dlg-body", "dlg-foot",
    "seg-opt", "sort-link", "sort-chev", "exp-lbl", "is-on", "is-open", "is-active",
    "btn-ghost", "btn-sm", "btn-run", "class-colored", "table-scroll",
    // the Discord preview is one component, styled by the two modules that embed it
    "dc-embed-body", "dc-empty", "dc-msg", "dc-time", "dc-name", "dc-text",
]);

/**
 * The prefixed class names a module's stylesheet mentions — its own vocabulary.
 * A module split into a folder of stylesheets (styles/raidplan/, #441) is all of them.
 */
function classesOf(file) {
    const full = path.join(STYLES, file);
    const css = fs.statSync(full).isDirectory()
        ? fs.readdirSync(full).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(full, f), "utf8")).join("\n")
        : fs.readFileSync(full, "utf8");
    const out = new Set();
    for (const m of css.matchAll(/\.([a-z]{2,4}-[\w-]+)/g)) {
        if (!SHARED.has(m[1])) out.add(m[1]);
    }
    return out;
}

describe("module stylesheets", () => {
    // a module is a stylesheet or a folder of them; the shared layer is none
    const files = fs.readdirSync(STYLES, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.name.endsWith(".css")) && !SHARED_FILES.includes(e.name))
        .map((e) => e.name);

    it("knows the shared layer: exactly the stylesheets index.css imports, in that order", () => {
        const index = fs.readFileSync(path.join(STYLES, "..", "index.css"), "utf8");
        const imports = [...index.matchAll(/@import "\.\/styles\/([\w-]+\.css)";/g)].map((m) => m[1]);
        expect(imports).toEqual(SHARED_FILES);
    });

    it("has more than one module to keep apart", () => {
        expect(files.length).toBeGreaterThan(5);
    });

    it("gives every module its own class names — one bundle, one namespace", () => {
        const sets = files.map((f) => [f, classesOf(f)]);
        const clashes = [];
        for (let i = 0; i < sets.length; i++) {
            for (let j = i + 1; j < sets.length; j++) {
                for (const name of sets[i][1]) {
                    if (sets[j][1].has(name)) clashes.push(`.${name}: ${sets[i][0]} + ${sets[j][0]}`);
                }
            }
        }
        expect(clashes).toEqual([]);
    });

    it("leaves the rc- prefix to Recruitment alone", () => {
        for (const file of files) {
            if (file === "recruitment.css") continue;
            const own = [...classesOf(file)].filter((n) => n.startsWith("rc-"));
            expect({ file, own }).toEqual({ file, own: [] });
        }
    });
});
