// The select chevron (index.css) is a background image with no-repeat and a
// fixed position. A rule that styles a <select> with the `background:` shorthand
// resets both — and the hover rule, which only swaps the image, then tiles the
// chevron across the whole control. So: every class a <select> carries sets
// `background-color`, never `background`.
const fs = require("fs");
const path = require("path");

const { sourceFiles } = require("../clientSource");

const files = sourceFiles("", /./);
const read = (f) => fs.readFileSync(f, "utf8");

/** The static classes on every <select className="…"> of the client. */
function selectClasses() {
    const classes = new Set();
    for (const f of files.filter((p) => p.endsWith(".tsx"))) {
        for (const m of read(f).matchAll(/<select[^>]*?className=\{?["'`]([^"'`}]+)["'`]/g)) {
            for (const c of m[1].split(/\s+/)) if (/^[\w-]+$/.test(c)) classes.add(c);
        }
    }
    return [...classes];
}

describe("select chevron", () => {
    it("finds the select classes to check", () => {
        expect(selectClasses()).toEqual(expect.arrayContaining(["kn-select"]));
    });

    it("never styles a select with the background shorthand", () => {
        const classes = selectClasses();
        const offenders = [];
        for (const f of files.filter((p) => p.endsWith(".css"))) {
            for (const m of read(f).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
                const selector = m[1].trim();
                if (!/(^|;|\s)background\s*:/.test(m[2])) continue;
                const onSelect = /(^|[\s,>+~])select(?![\w-])(?!\s+option)/.test(selector)
                    || classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(selector));
                if (onSelect) offenders.push(`${path.basename(f)}: ${selector}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
