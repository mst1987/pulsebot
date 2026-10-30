// Guard (#739): a category has one roster per game version, so every call of
// rosterForCategory( in src/ names the version - a source scan, so a new caller
// that forgets it fails here and not only on the live bot (where the store falls
// back to the version the category plays now, with a warning).
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "..", "src");
const SKIP = new Set(["node_modules", "web-client", "dist"]);

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP.has(entry.name)) return [];
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(full);
        return entry.name.endsWith(".js") ? [full] : [];
    });
}

/** The text between the call's parentheses (balanced), starting at the "(" at `open`. */
function argumentsAt(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") {
            depth -= 1;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    return text.slice(open + 1);
}

/** Top-level commas of an argument list: how many arguments it has. */
function argumentCount(args) {
    if (!args.trim()) return 0;
    let depth = 0;
    let count = 1;
    for (const ch of args) {
        if ("([{".includes(ch)) depth += 1;
        else if (")]}".includes(ch)) depth -= 1;
        else if (ch === "," && depth === 0) count += 1;
    }
    return count;
}

/** Every call of rosterForCategory( in a source text: `{ line, args }` (the definition and comments are no call). */
function callsIn(text) {
    const out = [];
    for (const m of text.matchAll(/\brosterForCategory\s*\(/g)) {
        const before = text.slice(Math.max(0, m.index - 9), m.index);
        if (before.endsWith("function ")) continue;
        const line = text.slice(0, m.index).split("\n").length;
        const lineText = text.split("\n")[line - 1].trim();
        if (lineText.startsWith("//") || lineText.startsWith("*")) continue;
        out.push({ line, args: argumentsAt(text, m.index + m[0].length - 1) });
    }
    return out;
}

describe("every rosterForCategory( call names a game version (#739)", () => {
    it("finds the callers at all (the scan works)", () => {
        const calls = jsFiles(SRC).flatMap((file) => callsIn(fs.readFileSync(file, "utf8")));
        expect(calls.length).toBeGreaterThanOrEqual(4);
    });

    it("finds no call with the category alone", () => {
        const missing = [];
        for (const file of jsFiles(SRC)) {
            for (const call of callsIn(fs.readFileSync(file, "utf8"))) {
                if (argumentCount(call.args) < 2) missing.push(`${path.relative(SRC, file).split(path.sep).join("/")}:${call.line} rosterForCategory(${call.args})`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("tells a call with a version from one without", () => {
        expect(callsIn("const r = rosterForCategory(cat);").map((c) => argumentCount(c.args))).toEqual([1]);
        expect(callsIn("const r = store.rosterForCategory(String(e.categoryId), versionOfEvent(e, { a, b }));").map((c) => argumentCount(c.args))).toEqual([2]);
        expect(callsIn("function rosterForCategory(categoryId, versionId) {}\n// rosterForCategory(x)")).toEqual([]);
    });
});
