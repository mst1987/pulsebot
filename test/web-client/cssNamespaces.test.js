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

const STYLES = path.join(__dirname, "..", "..", "src", "web-client", "src", "styles");

// Classes the shared building blocks own (index.css). A module may re-style them
// for its own page — always from its own scope, e.g. ".hl-card .part-head" —
// so they turn up in several files by design.
const SHARED = new Set([
    "page-head", "part-head", "ph-act", "ph-text", "dlg-head", "dlg-title", "dlg-body", "dlg-foot",
    "seg-opt", "sort-link", "sort-chev", "exp-lbl", "is-on", "is-open", "is-active",
    "btn-ghost", "btn-sm", "btn-run", "class-colored", "table-scroll",
    // the Discord preview is one component, styled by the two modules that embed it
    "dc-embed-body", "dc-empty", "dc-msg", "dc-time", "dc-name", "dc-text",
]);

/** The prefixed class names a stylesheet mentions — a module's own vocabulary. */
function classesOf(file) {
    const css = fs.readFileSync(path.join(STYLES, file), "utf8");
    const out = new Set();
    for (const m of css.matchAll(/\.([a-z]{2,4}-[\w-]+)/g)) {
        if (!SHARED.has(m[1])) out.add(m[1]);
    }
    return out;
}

describe("module stylesheets", () => {
    const files = fs.readdirSync(STYLES).filter((f) => f.endsWith(".css"));

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
