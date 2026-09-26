// Guard (#424): no require cycle anywhere in src/ (the React client in
// src/web-client/ aside, it has its own module system). It started with
// src/web, where three of them
// (setupEditor <-> setupPing, setupMessage <-> setupConfirmBot, raidplanAssign
// <-> raidplanCatalogStore) used to be hidden behind requires inside function
// bodies; a cycle hands a half-loaded module to whoever asks first. Every
// `require("./...")` counts here, the lazy ones too — a require moved into a
// function still closes the cycle, it only postpones the moment it bites.
//
// A new cycle fails with its members. The usual fix: move what both sides need
// into a small module below them (setupCore.js, raidplanConstants.js). Since
// the second part of #424 the whole tree is checked: utils/raidhelper/channelEvents.js,
// utils/raidhelper/queries.js and utils/raidhelper/fixture.js require their service and store modules
// at the top now, which is safe exactly because this graph has no cycle.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");
const SETUP = path.join(SRC, "services", "setup");
const SKIP = new Set(["web-client", "node_modules"]);

function srcFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP.has(entry.name)) out.push(...srcFiles(full));
        } else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
}

/** The src files a file requires by a relative path. */
function requiresOf(file, known) {
    const text = fs.readFileSync(file, "utf8");
    const out = [];
    for (const m of text.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
        const base = path.resolve(path.dirname(file), m[1]);
        const target = [base, `${base}.js`, path.join(base, "index.js")].find((p) => known.has(p));
        if (target) out.push(target);
    }
    return out;
}

/** Tarjan's strongly connected components; every component of more than one file is a cycle. */
function cycles(graph) {
    let index = 0;
    const idx = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const found = [];
    function visit(v) {
        idx.set(v, index);
        low.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
        for (const w of graph.get(v) || []) {
            if (!idx.has(w)) {
                visit(w);
                low.set(v, Math.min(low.get(v), low.get(w)));
            } else if (onStack.has(w)) {
                low.set(v, Math.min(low.get(v), idx.get(w)));
            }
        }
        if (low.get(v) === idx.get(v)) {
            const component = [];
            let w;
            do {
                w = stack.pop();
                onStack.delete(w);
                component.push(w);
            } while (w !== v);
            const selfLoop = component.length === 1 && (graph.get(v) || []).includes(v);
            if (component.length > 1 || selfLoop) found.push(component);
        }
    }
    for (const v of graph.keys()) if (!idx.has(v)) visit(v);
    return found;
}

describe("src require graph", () => {
    const files = srcFiles(SRC);
    const known = new Set(files);
    const graph = new Map(files.map((f) => [f, requiresOf(f, known)]));

    it("reads the modules and their requires", () => {
        expect(files.length).toBeGreaterThan(300);
        expect(files.some((f) => f.includes(`${path.sep}web-client${path.sep}`))).toBe(false);
        expect(graph.get(path.join(SETUP, "setupMessage.js"))).toContain(path.join(SETUP, "setupCore.js"));
        // across the layers too: utils -> stores
        expect(graph.get(path.join(SRC, "utils", "raidhelper", "queries.js"))).toContain(path.join(SRC, "stores", "eventStore.js"));
    });

    it("has no require cycle", () => {
        const named = cycles(graph).map((c) => c.map((f) => path.relative(SRC, f).replace(/\\/g, "/")).sort().join(" <-> "));
        expect(named).toEqual([]);
    });

    it("finds a cycle when there is one (the check itself works)", () => {
        const a = "a.js";
        const b = "b.js";
        const c = "c.js";
        expect(cycles(new Map([[a, [b]], [b, [c]], [c, [a]]]))).toHaveLength(1);
        expect(cycles(new Map([[a, [b]], [b, [c]], [c, []]]))).toEqual([]);
    });
});
