// CLAUDE.md is read in full by every agent in every session, so it stays the
// short entry point and the domain knowledge lives in docs/. These tests hold
// that split together: index and files must not drift apart, cross references
// must resolve, and CLAUDE.md must not grow back into the 120 KB document it
// once was.
//
// A topic too big for one file gets a folder (docs/raidplan/): its files are
// linked from the entry page of the same name (docs/raidplan.md), which stays
// in the index, so the index keeps one row per topic.
//
// The path guard (#418): every repository path the docs name (`src/...`,
// `scripts/...`, `test/...`, `assets/...`, `docs/...`) must exist, so a rename
// or a deleted module shows up here instead of misleading the next agent.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLAUDE = path.join(ROOT, "CLAUDE.md");
const DOCS = path.join(ROOT, "docs");

// Generous enough for a real change, tight enough to notice a section moving back in.
const MAX_LINES = 400;
const MAX_BYTES = 40 * 1024;

const read = (file) => fs.readFileSync(file, "utf8");

/** Every .md under docs/, as a path relative to docs/ with forward slashes ("raidplan/board.md"). */
function allDocFiles(dir = DOCS, prefix = "") {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return allDocFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        return entry.name.endsWith(".md") ? [prefix + entry.name] : [];
    }).sort();
}
const topLevelDocs = () => allDocFiles().filter((f) => !f.includes("/"));
const nestedDocs = () => allDocFiles().filter((f) => f.includes("/"));

function docLinks(text) {
    const links = new Set();
    const re = /(docs\/[A-Za-z0-9._/-]+\.md)/g;
    let m;
    while ((m = re.exec(text))) links.add(m[1]);
    return [...links].sort();
}

/** Markdown links to another .md file: `[..](events.md)`, `[..](../raidplan.md#editor)`. */
function relativeMdLinks(text) {
    const out = [];
    const re = /\]\(([^)\s:]+\.md)(#[^)\s]*)?\)/g;
    let m;
    while ((m = re.exec(text))) out.push({ target: m[1], anchor: m[2] ? decodeURIComponent(m[2].slice(1)) : "" });
    return out;
}

/** GitHub's anchor of a heading: lower case, punctuation dropped, spaces to dashes. */
function slug(heading) {
    return heading.trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
}
const anchorsOf = (text) => text.split(/\r?\n/).filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#{1,6} /, "")));

// Repository paths the path guard looks at. A path holding a placeholder or a
// glob (`<name>`, `*`, `{de,en}`, `…`) names a pattern, not a file, and build
// output or git-ignored files do not exist in a fresh checkout.
const REPO_PATH = /(?<![\w./@~-])((?:src|scripts|test|assets|docs)\/[^\s`'"()\][,;|]*)/g;
const PATTERN = /[<>*{}…]/;
const NOT_CHECKED_IN = [/^src\/web-client\/dist(\/|$)/, /^src\/web-client\/node_modules(\/|$)/];

function repoPaths(text) {
    const out = new Set();
    let m;
    while ((m = REPO_PATH.exec(text))) {
        const p = m[1].replace(/[.:!?]+$/, "").replace(/#.*$/, "");
        if (!p || PATTERN.test(p) || NOT_CHECKED_IN.some((re) => re.test(p))) continue;
        out.add(p);
    }
    return [...out].sort();
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

    test("every top-level file under docs/ is linked from the index", () => {
        const linked = new Set(docLinks(read(CLAUDE)));
        const unlisted = topLevelDocs().filter((f) => !linked.has("docs/" + f));
        expect(unlisted).toEqual([]);
    });

    test("the index lists each top-level file once, with a sentence saying what it is for", () => {
        const rows = read(CLAUDE).split(/\r?\n/).filter((l) => /^\|\s*\[docs\//.test(l));
        expect(rows.length).toBe(topLevelDocs().length);
        for (const row of rows) {
            const cells = row.split("|").map((c) => c.trim());
            expect(cells[1]).toMatch(/^\[(docs\/[A-Za-z0-9._-]+\.md)\]\(\1\)$/);
            expect(cells[2].length).toBeGreaterThan(20);
        }
    });
});

describe("the docs/ files", () => {
    test("each opens with exactly one top-level heading", () => {
        for (const file of allDocFiles()) {
            const lines = read(path.join(DOCS, file)).split(/\r?\n/);
            expect(`${file}: ${lines[0]}`).toMatch(/^[^:]+\.md: # \S/);
            expect(`${file}: ${lines.filter((l) => /^# \S/.test(l)).length}`).toBe(`${file}: 1`);
        }
    });

    test("a file in a topic folder is linked from the topic's entry page", () => {
        for (const file of nestedDocs()) {
            const [dir, name] = [path.posix.dirname(file), path.posix.basename(file)];
            const entry = path.join(DOCS, `${dir}.md`);
            const linked = fs.existsSync(entry) && relativeMdLinks(read(entry)).some((l) => l.target === `${dir}/${name}`);
            expect(`${file}: ${linked}`).toBe(`${file}: true`);
        }
    });

    test("their cross references point at files that exist", () => {
        for (const file of allDocFiles()) {
            const missing = docLinks(read(path.join(DOCS, file)))
                .filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
            expect(`${file}: ${missing.join(", ")}`).toBe(`${file}: `);
        }
    });

    test("their relative links to other docs resolve, anchors included", () => {
        for (const file of allDocFiles()) {
            const here = path.dirname(path.join(DOCS, file));
            const broken = relativeMdLinks(read(path.join(DOCS, file))).filter(({ target, anchor }) => {
                const abs = path.join(here, target);
                if (!fs.existsSync(abs)) return true;
                return anchor !== "" && !anchorsOf(read(abs)).includes(anchor.toLowerCase());
            }).map(({ target, anchor }) => target + (anchor ? `#${anchor}` : ""));
            expect(`${file}: ${broken.join(", ")}`).toBe(`${file}: `);
        }
    });

    test("a reference back into CLAUDE.md names a section that is still there", () => {
        const headings = read(CLAUDE).split(/\r?\n/)
            .filter((l) => /^#{1,6} /.test(l))
            .map((l) => l.replace(/^#{1,6} /, ""));
        for (const file of allDocFiles()) {
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

describe("the path guard", () => {
    test("every repository path CLAUDE.md and docs/ name exists", () => {
        const sources = [["CLAUDE.md", CLAUDE], ...allDocFiles().map((f) => [`docs/${f}`, path.join(DOCS, f)])];
        for (const [name, file] of sources) {
            const missing = repoPaths(read(file)).filter((p) => !fs.existsSync(path.join(ROOT, p)));
            expect(`${name}: ${missing.join(", ")}`).toBe(`${name}: `);
        }
    });

    test("patterns and build output are skipped, real paths are checked", () => {
        const text = "`src/bot.js`, `assets/emojis/eh_ui_<name>.png`, `src/utils/logcheck/*`, "
            + "`i18n/locales/{de,en}/x.json`, `src/web-client/dist/`, `raidplan/Palette.tsx`, "
            + "`src/web-client/src/lib/raidplan.ts`, docs/events.md.";
        expect(repoPaths(text)).toEqual(["docs/events.md", "src/bot.js", "src/web-client/src/lib/raidplan.ts"]);
    });

    test("the anchor of a heading is GitHub's", () => {
        expect(slug("Historie & Loot")).toBe("historie--loot");
        expect(slug("Log-Auswertung (CLA/RPB)")).toBe("log-auswertung-clarpb");
        expect(slug("Kanäle")).toBe("kanäle");
    });
});
