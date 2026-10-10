// Guard (#740): attendance is always counted within one game version, so every
// call of buildAttendanceContext( in src/ names the version - a source scan, so a
// new caller that forgets it fails here and not only on the live bot (where the
// function falls back to the main version with a warning).
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

/** Every call of buildAttendanceContext( in a source text: `{ line, args }` (the definition is no call). */
function callsIn(text) {
    const out = [];
    for (const m of text.matchAll(/buildAttendanceContext\s*\(/g)) {
        const before = text.slice(Math.max(0, m.index - 9), m.index);
        if (before.endsWith("function ")) continue;
        const line = text.slice(0, m.index).split("\n").length;
        // a comment naming the function is no call
        const lineText = text.split("\n")[line - 1].trim();
        if (lineText.startsWith("//") || lineText.startsWith("*")) continue;
        out.push({ line, args: argumentsAt(text, m.index + m[0].length - 1) });
    }
    return out;
}

describe("every buildAttendanceContext( call names a game version (#740)", () => {
    it("finds the callers at all (the scan works)", () => {
        const calls = jsFiles(SRC).flatMap((file) => callsIn(fs.readFileSync(file, "utf8")));
        expect(calls.length).toBeGreaterThanOrEqual(10);
    });

    it("finds no call without `versionId`", () => {
        const missing = [];
        for (const file of jsFiles(SRC)) {
            for (const call of callsIn(fs.readFileSync(file, "utf8"))) {
                if (!/\bversionId\b/.test(call.args)) missing.push(`${path.relative(SRC, file).split(path.sep).join("/")}:${call.line} buildAttendanceContext(${call.args})`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("tells a call with a version from one without", () => {
        expect(callsIn("const a = buildAttendanceContext(g, { now });").map((c) => /\bversionId\b/.test(c.args))).toEqual([false]);
        expect(callsIn("const a = buildAttendanceContext(g, { now, versionId: v(x) });").map((c) => /\bversionId\b/.test(c.args))).toEqual([true]);
        expect(callsIn("function buildAttendanceContext(guildId, opts = {}) {}\n// buildAttendanceContext(x)")).toEqual([]);
    });
});
