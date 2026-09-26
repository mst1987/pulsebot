// Shared by the client tests that need the translations (#i18n): the real
// dictionaries from src/web-client/src/i18n/locales, the real core
// (i18n/core.ts, run without its types) and a `t` bound to one language — so a
// lib that imports `t` can be run in Jest exactly as the page runs it.
//
//   const { makeT, loadTs } = require("./i18nHelper");
//   const lib = loadTs("lib/signups.ts", { t: makeT("de") });
//
// `loadTs` understands the TypeScript the libs are written in: import lines are
// dropped (pass what they imported as `inject`), `export type`/`type` blocks
// are skipped, one-line function signatures lose their types. Anything fancier
// (generics in a signature, `as` casts, typed consts) is out of its reach —
// keep such a lib's testable part simple, or test it by reading the source.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const LOCALES = path.join(CLIENT, "i18n", "locales");

const read = (rel) => fs.readFileSync(path.join(CLIENT, rel), "utf8").replace(/\r\n/g, "\n");

function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

/** "name: Type = default" -> "name = default"; "name?: Type" -> "name". */
function stripParam(p) {
    const trimmed = p.trim();
    if (!trimmed) return "";
    const eq = (() => {
        let depth = 0;
        for (let i = 0; i < trimmed.length; i++) {
            const c = trimmed[i];
            if (c === "=" && trimmed[i + 1] === ">") { i++; continue; }
            if ("(<{[".includes(c)) depth++;
            if (")>}]".includes(c)) depth--;
            if (c === "=" && depth === 0) return i;
        }
        return -1;
    })();
    const head = eq >= 0 ? trimmed.slice(0, eq) : trimmed;
    const name = head.split(":")[0].replace("?", "").trim();
    return eq >= 0 ? `${name} = ${trimmed.slice(eq + 1).trim()}` : name;
}

/** Skips a `type X = …;` / `export type X = …;` block starting at line i; returns the last line index. */
function skipType(lines, i) {
    let depth = 0;
    for (; i < lines.length; i++) {
        for (const c of lines[i]) { if ("({[".includes(c)) depth++; if (")}]".includes(c)) depth--; }
        if (depth === 0 && /;\s*$/.test(lines[i])) return i;
    }
    return i;
}

/** Runs a client .ts file (relative to src/web-client/src) and returns its top-level functions and consts. */
function loadTs(rel, inject = {}) {
    const lines = read(rel).split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import /.test(line)) {
            // multi-line imports end with the `from "…";` line
            while (i < lines.length && !/from ["'][^"']+["'];?\s*$/.test(lines[i]) && !/^import ["']/.test(lines[i])) i++;
            continue;
        }
        if (/^export \{.*\} from /.test(line)) continue;
        if (/^(export )?type \w+/.test(line)) { i = skipType(lines, i); continue; }
        const fn = line.match(/^(export )?function (\w+)(<[^(]*>)?\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[4]).map(stripParam).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        // a typed top-level `let x: T = …` / `const x: T = …` (api/csrf.ts) loses its type; a type holding "=" (a function type) is left alone
        if (/^(export )?(let|const) \w+: [^=]+ = /.test(line)) { out.push(line.replace(/^(export )?(let|const) (\w+): [^=]+ = /, "$2 $3 = ")); continue; }
        // lib/raidplan.ts uses type assertions (`x as Foo`) and lib/setupEditor.ts typed locals, which are only types: drop them there (no other lib is touched)
        out.push(line.replace(rel === "lib/assign.ts" || rel === "lib/steps.ts" ? /^\} as Record<.*>;$/ : /(?!)/, "};").replace(rel === "lib/setupEditor.ts" ? /^(\s*const \w+): Partial<.*?> = / : /(?!)/, "$1 = ").replace(/^export (default )?/, "").replace(rel === "lib/raidplan.ts" || rel === "lib/assign.ts" ? / as [A-Za-z_]\w*(\["\w+"\])?/g : /(?!)/g, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const|let) (\w+)/gm)].map((m) => m[1]);
    const keys = Object.keys(inject);
    return new Function(...keys, `${js}\nreturn { ${names.join(", ")} };`)(...keys.map((k) => inject[k]));
}

let core = null;
/** i18n/core.ts, run as it is. */
function loadCore() {
    if (!core) core = loadTs("i18n/core.ts");
    return core;
}

/** The namespace files of one language: { ns: tree }. */
function namespaces(lang) {
    const dir = path.join(LOCALES, lang);
    const out = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        out[file.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    }
    return out;
}

/** One language's flat dictionary, built the way i18n/index.ts builds it. */
function flatDict(lang) {
    const { flatten } = loadCore();
    const dict = {};
    for (const [ns, tree] of Object.entries(namespaces(lang))) flatten(tree, ns, dict);
    return dict;
}

let dicts = null;
function allDicts() {
    if (!dicts) dicts = { de: flatDict("de"), en: flatDict("en") };
    return dicts;
}

/** A `t` fixed to one language, with the real fallback rules. Collects missing keys on `t.missing`. */
function makeT(lang = "de") {
    const { translate } = loadCore();
    const missing = [];
    const t = (key, params) => translate(allDicts(), lang, key, params, (l, k) => missing.push(k));
    t.missing = missing;
    return t;
}

/** tOr as i18n/index.ts has it, for libs that use it. */
function makeTOr(lang = "de") {
    const t = makeT(lang);
    const d = allDicts();
    return (key, fallback, params) => (d[lang][key] !== undefined || d.de[key] !== undefined ? t(key, params) : fallback);
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

module.exports = { CLIENT, LOCALES, loadTs, loadCore, namespaces, flatDict, allDicts, makeT, makeTOr, read, stripComments };
