// Inline styles in the React client (#441): a fixed look belongs in a class of
// the module's stylesheet; a value that differs per element (a width, a colour,
// a position on the raid plan board) goes in as a CSS custom property that the
// stylesheet reads — `style={{ "--fill": `${pct}%` } as CSSProperties}` plus
// `.bar i { width: var(--fill); }`. So every style object literal written in
// JSX carries custom properties only.
const { clientSources, stripComments } = require("../clientSource");

/** The `style={{ ... }}` object literals of a source, with their line. */
function styleObjects(src) {
    const out = [];
    let i = src.indexOf("style={{");
    while (i >= 0) {
        let depth = 0;
        let j = i + "style={".length;
        for (; j < src.length; j++) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") { depth--; if (depth === 0) break; }
        }
        out.push({ line: src.slice(0, i).split("\n").length, body: src.slice(i + "style={{".length, j) });
        i = src.indexOf("style={{", j);
    }
    return out;
}

/** The top-level keys of an object literal body that are not custom properties. */
function plainKeys(body) {
    const keys = [];
    let depth = 0;
    let start = 0;
    const parts = [];
    for (let k = 0; k < body.length; k++) {
        const c = body[k];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "," && depth === 0) { parts.push(body.slice(start, k)); start = k + 1; }
    }
    parts.push(body.slice(start));
    for (const raw of parts) {
        const p = raw.trim();
        if (!p || p.startsWith("...")) continue;
        const m = p.match(/^(\[?"--[\w-]+"(?: as string)?\]?|"--[\w-]+")\s*:/);
        if (m) continue;
        const key = p.match(/^([\w$]+)\s*:/);
        keys.push(key ? key[1] : p.slice(0, 30));
    }
    return keys;
}

describe("inline styles", () => {
    it("reads the style objects of a source", () => {
        const src = "<i style={{ \"--fill\": `${pct}%` } as CSSProperties} /><b style={{ width: 3, \"--x\": f({ a: 1 }) }} />";
        expect(styleObjects(src).map((o) => plainKeys(o.body))).toEqual([[], ["width"]]);
    });

    it("are custom properties only: a fixed look is a class, a per-element value a --variable", () => {
        const offenders = [];
        for (const [file, raw] of clientSources()) {
            for (const o of styleObjects(stripComments(raw))) {
                const keys = plainKeys(o.body);
                if (keys.length) offenders.push(`${file}:${o.line} ${keys.join(", ")}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
