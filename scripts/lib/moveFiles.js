"use strict";

// Plans moving source files into other folders (#1006): where each file goes and
// how every reference to a moved file - or from a moved file - has to change.
// Pure: it works on the list of repository paths and the contents of the text
// files; scripts/move-files.js reads the checkout and writes the result.
//
// Three kinds of references are followed:
//  - relative paths ("./x", "../a/b.ts") in code and Markdown: require, import,
//    jest.mock, vi.mock, Markdown links, path strings - resolved the way Node and
//    Vite resolve them (extension and index file may be left out);
//  - full repository paths ("src/stores/eventStore.js", in code also without the
//    extension), in every text file;
//  - the tail of a path with an extension that names exactly one file in the
//    repository ("lib/raidplan/assign.ts" in a convention test reading a source).
// Paths built from pieces (path.join(__dirname, "..", "stores")) are not seen;
// the test run after a move finds those.

const path = require("path").posix;

const RELATIVE_FILE = /\.(c|m)?[jt]sx?$|\.css$|\.md$/;
const CODE_EXT = [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"];
const RESOLVE = [
    ...["", ...CODE_EXT, ".json"].map((ext) => ({ add: ext, kind: ext ? "ext" : "exact" })),
    ...CODE_EXT.map((ext) => ({ add: `/index${ext}`, kind: "index" })),
];
// a path-like token that does not start in the middle of a longer one
const TOKEN = /(?<![\w.@/-])(?:(?:\.{1,2}\/)+[\w.@-]+(?:\/[\w.@-]+)*|[\w.@-]+(?:\/[\w.@-]+)+)/g;
// a bare "." or ".." (the folder's index) - only where a module is named, split(".") stays
const BARE_DOTS = /((?:\bfrom\s*|\b(?:import|require|mock|doMock|requireActual|importActual)\s*\(\s*)["'])(\.{1,2})(?=["'])/g;

const withoutExt = (file) => file.slice(0, file.length - path.extname(file).length);

/** "src/a.js" -> "./x/", "dir" -> "other/dir": every file this mapping moves, as [from, to]. */
function expandMapping(mapping, files) {
    const all = new Set(files);
    const moves = new Map();
    for (const [from, rawTo] of Object.entries(mapping)) {
        const source = from.replace(/\/+$/, "");
        if (all.has(source)) {
            const to = rawTo.endsWith("/") ? rawTo + path.basename(source) : rawTo;
            moves.set(source, to);
            continue;
        }
        const inside = files.filter((f) => f.startsWith(`${source}/`));
        if (!inside.length) throw new Error(`${from}: weder Datei noch Ordner im Repository`);
        const target = rawTo.replace(/\/+$/, "");
        for (const file of inside) moves.set(file, target + file.slice(source.length));
    }
    return moves;
}

/**
 * The tests of every moved module move along: a backend module src/<x>.js has them in
 * test/<x>.test.js and test/<x>.<part>.test.js, a client module <dir>/<name>.ts(x) in
 * <dir>/__tests__/<name>.test.ts(x) and <name>.<part>.test.ts(x).
 */
function addMirroredTests(moves, files) {
    for (const [from, to] of [...moves]) {
        let testDir;
        let newDir;
        if (from.startsWith("src/web-client/") && /\.tsx?$/.test(from) && !/\.test\.tsx?$/.test(from)) {
            testDir = `${path.dirname(from)}/__tests__`;
            newDir = `${path.dirname(to)}/__tests__`;
        } else if (from.startsWith("src/") && !from.startsWith("src/web-client/") && from.endsWith(".js")) {
            testDir = path.dirname(`test/${from.slice(4)}`);
            newDir = path.dirname(`test/${to.slice(4)}`);
        } else {
            continue;
        }
        const name = withoutExt(path.basename(from));
        for (const file of files) {
            if (path.dirname(file) !== testDir || moves.has(file)) continue;
            const base = path.basename(file);
            if (base.startsWith(`${name}.`) && /\.test\.(js|tsx?)$/.test(base)) moves.set(file, `${newDir}/${base}`);
        }
    }
}

function checkMoves(moves, files) {
    const all = new Set(files);
    const targets = new Set();
    for (const [from, to] of moves) {
        if (from === to) throw new Error(`${from}: Ziel ist gleich der Quelle`);
        if (targets.has(to)) throw new Error(`${to}: zwei Dateien mit demselben Ziel`);
        if (all.has(to) && !moves.has(to)) throw new Error(`${to}: dort liegt schon eine Datei`);
        targets.add(to);
    }
}

/** Each tail of a path with at least two parts ("raidplan/assign.ts") -> the one file ending with it, or null. */
function tailIndex(files) {
    const index = new Map();
    for (const file of files) {
        const parts = file.split("/");
        for (let i = parts.length - 2; i >= 1; i -= 1) {
            const tail = parts.slice(i).join("/");
            index.set(tail, index.has(tail) ? null : file);
        }
    }
    return index;
}

/**
 * The plan for a move.
 * @param {string[]} files every repository path (posix)
 * @param {Map<string,string>} contents the text files to rewrite, path -> content
 * @param {Record<string,string>} mapping from -> to; a folder moves with everything in it,
 *   a target ending in "/" keeps the file name
 * @param {{mirrorTests?: boolean}} [options] mirrorTests: the tests of backend modules move along
 * @returns {{moves: [string,string][], writes: Map<string,string>, warnings: string[]}}
 *   writes: new content by the file's path after the move
 */
function planMove(files, contents, mapping, options = {}) {
    const moves = expandMapping(mapping, files);
    if (options.mirrorTests) addMirroredTests(moves, files);
    checkMoves(moves, files);

    const all = new Set(files);
    const dirs = new Set(files.flatMap((f) => {
        const parts = f.split("/");
        return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
    }));
    const tails = tailIndex(files);
    const movedTo = (file) => moves.get(file) || file;
    const warnings = [];

    function relativeFrom(fromDir, target) {
        const rel = path.relative(fromDir, target);
        if (!rel) return ".";
        return rel.startsWith(".") ? rel : `./${rel}`;
    }

    function rewriteRelative(token, file, newFile) {
        const base = path.normalize(path.join(path.dirname(file), token));
        const hit = RESOLVE.find((r) => all.has(base + r.add));
        if (!hit) {
            // a folder: only the file moving changes how it is reached
            if (!dirs.has(base) || newFile === file) return token;
            return relativeFrom(path.dirname(newFile), base);
        }
        const target = base + hit.add;
        const newTarget = movedTo(target);
        if (newTarget === target && newFile === file) return token;
        let newBase = newTarget;
        if (hit.kind === "ext") newBase = withoutExt(newTarget);
        if (hit.kind === "index") newBase = path.dirname(newTarget);
        return relativeFrom(path.dirname(newFile), newBase);
    }

    function rewriteAbsolute(token, file, code) {
        if (moves.has(token)) return moves.get(token);
        if (code && !path.extname(token)) {
            const hits = CODE_EXT.filter((ext) => moves.has(token + ext));
            if (hits.length === 1) return withoutExt(moves.get(token + hits[0]));
        }
        const old = path.extname(token) ? tails.get(token) : null;
        if (!old || !moves.has(old)) return token;
        const root = old.slice(0, old.length - token.length);
        const target = moves.get(old);
        if (!target.startsWith(root)) {
            warnings.push(`${file}: "${token}" zeigt auf ${old}, das nach ${target} zieht - von Hand anpassen`);
            return token;
        }
        return target.slice(root.length);
    }

    const writes = new Map();
    for (const [file, content] of contents) {
        const newFile = movedTo(file);
        const relative = RELATIVE_FILE.test(file);
        const code = /\.(c|m)?[jt]sx?$/.test(file);
        const next = content.replace(TOKEN, (match) => {
            // a sentence may end right after a path ("… in src/x.js."); "../.." stays whole
            const token = match.replace(/(?<=[^./])\.+$/, "");
            const rest = match.slice(token.length);
            if (!token.includes("/")) return match;
            const replaced = token.startsWith(".")
                ? (relative ? rewriteRelative(token, file, newFile) : token)
                : rewriteAbsolute(token, file, code);
            return replaced + rest;
        });
        const final = code
            ? next.replace(BARE_DOTS, (match, head, dots) => head + rewriteRelative(dots, file, newFile))
            : next;
        if (final !== content) writes.set(newFile, final);
    }
    return { moves: [...moves], writes, warnings };
}

module.exports = { planMove, expandMapping };
