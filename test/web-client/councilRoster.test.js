// Guards for the loot council's roster layout and the marks on a worn item
// (src/web-client/src/pages/LootCouncilPage.tsx + index.css).
//
// Two things the old table got wrong, and the invariants that keep them fixed:
//   * the gear sat in a second table row, exactly between two names, so nobody
//     could say whose set a strip of icons was — now every raider is one block
//     with a class-coloured rail, and the gear band lives *inside* it;
//   * a BiS piece was marked by a 1.5px border in the accent colour, invisible
//     next to sixteen other borders — now it carries a "BiS" tag in a corner of
//     its own, and the other marks keep to their corners.
// There is no React test renderer in this project, so the checks are on the
// source: the structure, and the CSS that gives each mark its corner.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
// Line endings normalised: a Windows checkout has CRLF, and the anchors below
// look for "\n}\n".
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");
const page = read("pages", "LootCouncilPage.tsx");
const css = read("index.css");
const sortTh = read("components", "SortTh.tsx");

/** The body of one top-level function in the page source. */
function fn(name) {
    const m = page.match(new RegExp(`\\nfunction ${name}\\b[\\s\\S]*?\\n}\\n`));
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
}

/** One CSS rule's declarations. */
function rule(selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`rule ${selector} not found`);
    return m[1];
}

describe("loot council — raider blocks", () => {
    it("renders one block per raider, not a table with a gear row", () => {
        expect(page).not.toMatch(/className="idx lc-roster"/);
        expect(page).not.toMatch(/function GearRow/);
        expect(page).toMatch(/function RaiderBlock/);
        expect(page).toMatch(/<RaiderBlock\s/);
    });

    it("keeps the gear inside the raider's block, under the rail", () => {
        // The band is the last child of the block — the gear is never a sibling
        // of the block that owns it.
        const block = fn("RaiderBlock");
        expect(block).toMatch(/<article className="lc-raider" style=\{classColorProps\(r\.classColor\)\.style\}/);
        expect(block).toMatch(/<GearBand raider=\{r\} \/>\s*<\/article>/);
        // The rail is the class colour handed down as --cc.
        expect(rule(".lc-raider")).toMatch(/border-left: 4px solid var\(--cc/);
    });

    it("labels the band and says how many BiS pieces are worn", () => {
        const band = fn("GearBand");
        expect(band).toMatch(/<span className="lc-kicker">Gear<\/span>/);
        expect(band).toMatch(/BiS \{raider\.bis\.owned\}\/\{raider\.bis\.total\}/);
        expect(band).toMatch(/ohne VZ/);
        expect(band).toMatch(/Sockel leer/);
        // The stamp (when the gear was seen, and whether it is the right kind)
        // moved into the band with the gear it describes.
        expect(band).toMatch(/<GearStamp raider=\{raider\} \/>/);
    });

    it("groups the strip into armour, jewellery and weapons", () => {
        // Slot ids from utils/logcheck/gearIssues.js: 10-13 are rings and
        // trinkets, 15-17 the weapons; everything else is armour.
        expect(page).toMatch(/const GEAR_GROUPS: number\[\]\[\] = \[\[0, 1, 2, 14, 4, 8, 9, 5, 6, 7\], \[10, 11, 12, 13\], \[15, 16, 17\]\];/);
        expect(fn("GearBand")).toMatch(/<span className="lc-gear-sep" \/>/);
    });

    it("keeps every column sortable through the shared sort button", () => {
        // The grid header is not a <th>, so the button is shared out of SortTh.
        expect(sortTh).toMatch(/export function SortLabel/);
        expect(sortTh).toMatch(/export function ariaSort/);
        const head = fn("SortHead");
        expect(head).toMatch(/role="columnheader" aria-sort=\{ariaSort\(sortKey, sort, dir\)\}/);
        for (const key of ["character", "need", "loot", "last", "bis", "dps", "spec", "gear"]) {
            expect(page).toContain(`<SortHead sortKey="${key}"`);
        }
    });

    it("lines the header up with the blocks by sharing one grid", () => {
        expect(css).toMatch(/\.lc-roster-head, \.lc-raider-head \{\s*display: grid;/);
    });

    it("explains the marks once, in the roster's header", () => {
        expect(page).toMatch(/actions=\{<GearLegend \/>\}/);
        const legend = fn("GearLegend");
        expect(legend).toMatch(/lc-worn-tag-bis/);
        expect(legend).toMatch(/lc-worn-tag-noench/);
        expect(legend).toMatch(/lc-worn-tag-socket/);
    });

    it("still guards the per-raider actions with the busy state", () => {
        const block = fn("RaiderBlock");
        expect(block).toContain("disabled={busy.has(`export:${r.character}`)}");
        expect(block).toContain("disabled={busy.has(`exclude:${r.character}`)}");
    });
});

describe("loot council — marks on a worn item", () => {
    const worn = fn("WornIcon");

    it("tags a BiS piece with a readable label, not only a border", () => {
        expect(worn).toMatch(/\{item\.isBis \? <span className="lc-worn-tag lc-worn-tag-bis"[^>]*>BiS<\/span> : null\}/);
        // ...and the border is now thick enough to be seen, with a glow.
        const bis = rule(".lc-worn-bis .lc-worn-img");
        expect(bis).toMatch(/border: 2px solid var\(--accent-2\)/);
        expect(bis).toMatch(/box-shadow:/);
    });

    it("gives every mark a corner of its own", () => {
        // BiS bottom right, no enchant top left, empty socket top right, the
        // comparison marks bottom left — none of them can cover another.
        expect(rule(".lc-worn-tag-bis")).toMatch(/right: -4px; bottom: -5px;/);
        expect(rule(".lc-worn-tag-noench")).toMatch(/left: -5px; top: -5px;/);
        expect(rule(".lc-worn-tag-socket")).toMatch(/right: -4px; top: -4px;/);
        const mark = rule(".lc-worn-mark");
        expect(mark).toMatch(/left: -3px;/);
        expect(mark).toMatch(/bottom: -3px;/);
        expect(mark).not.toMatch(/right: -3px;/);
    });

    it("marks a missing enchant and an empty socket without a hover", () => {
        expect(worn).toMatch(/\{noench \? <span className="lc-worn-tag lc-worn-tag-noench"/);
        expect(worn).toMatch(/\{item\.emptySockets > 0\s*\? <span className="lc-worn-tag lc-worn-tag-socket"/);
    });

    it("lets a BiS piece keep its border when it also lacks an enchant", () => {
        // Both can be true at once; the red border would otherwise win by order.
        expect(rule(".lc-worn-bis.lc-worn-noench .lc-worn-img")).toMatch(/border-color: var\(--accent-2\)/);
    });

    it("uses the theme's accent for the tag, so it reads in both themes", () => {
        // A hard-coded teal on white is the light-theme problem this avoids.
        const tag = rule(".lc-worn-tag-bis");
        expect(tag).toMatch(/background: var\(--accent-2\); color: var\(--accent-ink\);/);
        expect(tag).not.toMatch(/#[0-9a-f]{6}/i);
    });
});

describe("loot council — candidates and the drop check", () => {
    it("shows the candidate as the same spec-plus-name identity as the roster", () => {
        const row = fn("CandidateRow");
        expect(row).toMatch(/<span className="lc-cand-ident">\s*<SpecCell/);
        expect(row).not.toMatch(/<td><SpecCell/);
        // ...so the candidate table has no separate spec column left to sort.
        expect(fn("CandidateTable")).not.toMatch(/<SortTh sortKey="spec"/);
    });

    it("heads a BiS card and the picked drop with the same item block", () => {
        expect(page).toMatch(/function ItemHead/);
        expect(fn("GapCard")).toMatch(/<ItemHead\s/);
        expect(fn("DropPanel")).toMatch(/<ItemHead\s/);
        expect(page).not.toMatch(/lc-dropitem-head/);
    });

    it("lifts the suggestion into a band of its own on the BiS card", () => {
        const card = fn("GapCard");
        expect(card).toMatch(/<div className="lc-gap-verdict">\s*<span className="lc-kicker">Vorschlag<\/span>/);
        expect(card).not.toMatch(/Vorschlag: <b>/);
    });

    it("labels the drop check's verdict values and shows what would be replaced", () => {
        const drop = fn("DropPanel");
        for (const label of ["Bedarf", "Zuletzt", "Items", "Ersetzt"]) {
            expect(drop).toContain(`<span className="lc-kicker">${label}</span>`);
        }
        expect(drop).toMatch(/<SlotOptions candidate=\{best\} \/>/);
    });
});
