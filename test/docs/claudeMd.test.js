// CLAUDE.md is read in full by every agent in every session, so it stays the
// short entry point and the domain knowledge lives in docs/. These tests hold
// that split together: index and files must not drift apart, cross references
// must resolve, and CLAUDE.md must not grow back into the 120 KB document it
// once was.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLAUDE = path.join(ROOT, "CLAUDE.md");
const DOCS = path.join(ROOT, "docs");

// Generous enough for a real change, tight enough to notice a section moving back in.
const MAX_LINES = 400;
const MAX_BYTES = 40 * 1024;

const read = (file) => fs.readFileSync(file, "utf8");
const docFiles = () => fs.readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();

function docLinks(text) {
    const links = new Set();
    const re = /(docs\/[A-Za-z0-9._-]+\.md)/g;
    let m;
    while ((m = re.exec(text))) links.add(m[1]);
    return [...links].sort();
}

describe("CLAUDE.md stays the short entry point", () => {
    test("it is under the size limit", () => {
        const text = read(CLAUDE);
        expect(text.split(/\r?\n/).length).toBeLessThanOrEqual(MAX_LINES);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_BYTES);
    });

    test("every docs/ file it links to exists", () => {
        const missing = docLinks(read(CLAUDE)).filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
        expect(missing).toEqual([]);
    });

    test("every file under docs/ is linked from the index", () => {
        const linked = new Set(docLinks(read(CLAUDE)));
        const unlisted = docFiles().filter((f) => !linked.has("docs/" + f));
        expect(unlisted).toEqual([]);
    });

    test("the index lists each file once, with a sentence saying what it is for", () => {
        const rows = read(CLAUDE).split(/\r?\n/).filter((l) => /^\|\s*\[docs\//.test(l));
        expect(rows.length).toBe(docFiles().length);
        for (const row of rows) {
            const cells = row.split("|").map((c) => c.trim());
            expect(cells[1]).toMatch(/^\[(docs\/[A-Za-z0-9._-]+\.md)\]\(\1\)$/);
            expect(cells[2].length).toBeGreaterThan(20);
        }
    });
});

describe("the docs/ files", () => {
    test("each opens with exactly one top-level heading", () => {
        for (const file of docFiles()) {
            const lines = read(path.join(DOCS, file)).split(/\r?\n/);
            expect(`${file}: ${lines[0]}`).toMatch(/^[^:]+\.md: # \S/);
            expect(`${file}: ${lines.filter((l) => /^# \S/.test(l)).length}`).toBe(`${file}: 1`);
        }
    });

    test("their cross references point at files that exist", () => {
        for (const file of docFiles()) {
            const missing = docLinks(read(path.join(DOCS, file)))
                .filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
            expect(`${file}: ${missing.join(", ")}`).toBe(`${file}: `);
        }
    });

    test("a reference back into CLAUDE.md names a section that is still there", () => {
        const headings = read(CLAUDE).split(/\r?\n/)
            .filter((l) => /^#{1,6} /.test(l))
            .map((l) => l.replace(/^#{1,6} /, ""));
        for (const file of docFiles()) {
            const re = /["“„]([^"“”„]{3,60})["”“]\s+in CLAUDE\.md/g;
            let m;
            while ((m = re.exec(read(path.join(DOCS, file))))) {
                const name = m[1];
                const hit = headings.some((h) => h.startsWith(name));
                expect(`${file} -> ${name}: ${hit}`).toBe(`${file} -> ${name}: true`);
            }
        }
    });
});
