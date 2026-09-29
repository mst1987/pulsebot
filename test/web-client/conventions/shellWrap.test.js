// Narrow screens (#551): the shell must never get wider than the viewport.
// A plain `1fr` grid track or a flex child without `min-width: 0` grows to its
// widest unbreakable child and pushes the page sideways; a row without
// `flex-wrap` gets cut off at the edge. These are the rules that keep the
// shell (styles/shared.css) and the page head (styles/ui.css) inside 390 px.
const { read } = require("../clientSource");

const css = read("index.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** All declarations of every rule whose selector list names `selector` exactly. */
function declarations(selector, source = css) {
    const found = [];
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(",").map((s) => s.trim());
        if (selectors.includes(selector)) found.push(m[2]);
    }
    return found.join(";").replace(/\s+/g, " ");
}

/** The body of the first `@media (max-width: <px>px)` block holding `selector`. */
function mediaBlock(px, selector) {
    const head = `@media (max-width: ${px}px)`;
    let from = 0;
    for (;;) {
        const at = css.indexOf(head, from);
        if (at < 0) return "";
        const open = css.indexOf("{", at);
        let depth = 1, i = open + 1;
        while (depth && i < css.length) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
            i++;
        }
        const body = css.slice(open + 1, i - 1);
        if (declarations(selector, body)) return body;
        from = i;
    }
}

describe("shell keeps inside a narrow viewport (#551)", () => {
    it("gives the page column minmax(0, 1fr), never a bare 1fr", () => {
        expect(declarations(".app")).toMatch(/grid-template-columns:\s*248px minmax\(0, 1fr\)/);
        expect(declarations(".app", mediaBlock(900, ".app"))).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    });

    it.each([".main", ".content", ".crumbs", ".top-actions", ".guild-sel"])("%s may shrink (min-width: 0)", (sel) => {
        expect(declarations(sel)).toMatch(/min-width:\s*0/);
    });

    it.each([".topbar", ".top-actions", ".page-head", ".page-head .ph-act", ".page-head .ph-meta", ".row-actions"])("%s wraps its row", (sel) => {
        expect(declarations(sel)).toMatch(/flex-wrap:\s*wrap/);
    });

    it("keeps the head's action row inside the column", () => {
        expect(declarations(".page-head .ph-act")).toMatch(/max-width:\s*100%/);
        expect(declarations(".top-actions")).toMatch(/max-width:\s*100%/);
    });

    it("lets a segment switch wrap on a phone instead of cutting it off", () => {
        expect(declarations(".seg", mediaBlock(600, ".seg"))).toMatch(/flex-wrap:\s*wrap/);
    });

    it("shadows the mobile drawer only while it is open", () => {
        const mobile = mediaBlock(900, ".side");
        expect(declarations(".side", mobile)).not.toMatch(/box-shadow/);
        expect(declarations(".side.open", mobile)).toMatch(/box-shadow/);
    });
});
