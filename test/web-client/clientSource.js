// Source readers for the convention tests under test/web-client/conventions/
// (#435). Those tests check structural promises of the React client that a
// render test cannot see (a stylesheet per module, no duplicate building
// block, lazy routes, no native title, ...). Behaviour of the client is tested
// in Vitest next to the code (src/web-client/src/**/*.test.ts(x)).
//
// Every walk here skips the client's own tests (*.test.ts(x), src/test/): a
// test file may name the very thing a convention forbids.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const LOCALES = path.join(CLIENT, "i18n", "locales");

/** A client file (path parts relative to src/web-client/src), with LF line endings. */
function read(...parts) {
    // strings only, so `files.map(read)` works (map also passes index and array)
    return fs.readFileSync(path.join(CLIENT, ...parts.filter((p) => typeof p === "string")), "utf8").replace(/\r\n/g, "\n");
}

/** Whether a path belongs to the tests rather than the app. */
function isTestFile(file) {
    const rel = path.relative(CLIENT, file).split(path.sep).join("/");
    return /\.test\.[jt]sx?$/.test(rel) || rel.startsWith("test/");
}

/**
 * The app's source files under `dir` (relative to src/web-client/src, default
 * the whole client) whose name matches `ext`, as absolute paths, sorted.
 * `recursive: false` stays in `dir` itself.
 */
function sourceFiles(dir = "", ext = /\.tsx?$/, { recursive = true } = {}) {
    const out = [];
    (function walk(abs) {
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            const full = path.join(abs, e.name);
            if (e.isDirectory()) { if (recursive) walk(full); }
            else if (ext.test(e.name) && !isTestFile(full)) out.push(full);
        }
    })(path.join(CLIENT, dir));
    return out.sort();
}

/** [relative name with forward slashes, source] for every app file under `dir`. */
function clientSources(dir = "", ext = /\.tsx?$/, options = {}) {
    return sourceFiles(dir, ext, options).map((full) => [
        path.relative(CLIENT, full).split(path.sep).join("/"),
        fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n"),
    ]);
}

/**
 * The source without its comments (block, JSX `{/* … *\/}` and whole-line `//`),
 * so a scan for literals does not trip over a comment quoting the old text.
 * A `//` after code is dropped only when a space precedes it (keeps "https://").
 */
function stripComments(src) {
    return src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => (/^\s*\/\//.test(line) ? "" : line.replace(/\s\/\/\s.*$/, "")))
        .join("\n");
}

/** The namespace files of one language: { ns: tree } (plain JSON, no translation logic). */
function namespaces(lang) {
    const dir = path.join(LOCALES, lang);
    const out = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        out[file.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    }
    return out;
}

/**
 * One language's texts as { "ns.dotted.key": text }, read straight from the
 * JSON — a plural object ({ one, other }) stays whole. For "does this key
 * exist" checks; translating (params, plurals, fallback) is tested in Vitest.
 */
function dictionary(lang) {
    const out = {};
    const walk = (node, prefix) => {
        const plural = node && typeof node === "object" && typeof node.other === "string";
        if (typeof node === "string" || plural) { out[prefix] = node; return; }
        for (const [k, v] of Object.entries(node || {})) walk(v, `${prefix}.${k}`);
    };
    for (const [ns, tree] of Object.entries(namespaces(lang))) walk(tree, ns);
    return out;
}

module.exports = { CLIENT, LOCALES, read, isTestFile, sourceFiles, clientSources, stripComments, namespaces, dictionary };
