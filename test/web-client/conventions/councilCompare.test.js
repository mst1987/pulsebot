// Guards for the loot council's comparison matrix — the "Loot-Vergleich" tab
// (src/web-client/src/pages/lootcouncil/LootCouncilPage.tsx + index.css).
//
// Columns are raiders, rows are items: what the toggled raiders got in the
// filtered content, side by side, so a council choosing between three warlocks
// sees the three in one table instead of three hovers. There is no React test
// renderer in this project, so the checks are on the source — the invariants
// that would silently rot:
//   * the tab exists and is switched like the others,
//   * the matrix is built from the roster's own item lists (same content
//     filter, same "what counts as loot" rule — never a second request),
//   * rows are grouped by raid and ordered like a character sheet,
//   * the raider switches persist in the view like the BiS-list switches,
//   * the item column stays sticky and a cell says "BiS offen" rather than
//     staying blank when the item is still open on that raider's list.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");
// the page with its tabs (the comparison is CompareTab.tsx, the view view.ts; #438)
const { files, fn: fnIn } = require("./councilHelpers");

const page = files.page;
const css = read("index.css");
const api = read("api", "lootcouncil.ts");

/** The body of one top-level function in the page source. */
function fn(name) {
    return fnIn(page, name);
}

/** One CSS rule's declarations. */
function rule(selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`rule ${selector} not found`);
    return m[1];
}

describe("loot council — the comparison tab", () => {
    it("is a tab of its own next to the BiS lists", () => {
        expect(page).toMatch(/tab: "roster" \| "bis" \| "drop" \| "bislists" \| "compare";/);
        expect(page).toMatch(/onClick=\{\(\) => patch\(\{ tab: "compare" \}\)\}/);
        expect(page).toMatch(/view\.tab === "compare" \? <CompareTab roster=\{roster\} view=\{view\} patch=\{patch\} contents=\{o\.contents\} \/> : null/);
    });

    it("remembers which raiders are switched off in the persisted view", () => {
        // Like listOff for the BiS lists: the switches survive a reload and a
        // filter change; a key that is no longer in the roster is simply
        // ignored by the filter.
        expect(page).toMatch(/cmpOff: string\[\];/);
        expect(page).toMatch(/listFocus: 0, cmpOff: \[\],/);
        const tab = fn("CompareTab");
        expect(tab).toMatch(/const off = useMemo\(\(\) => new Set\(view\.cmpOff\), \[view\.cmpOff\]\);/);
        expect(tab).toMatch(/roster\.filter\(\(r\) => !off\.has\(r\.key\)\)/);
        // Every raider is one switch, class-coloured, with the spec icon.
        expect(tab).toMatch(/className=\{`lc-blspec\$\{off\.has\(r\.key\) \? " off" : ""\}`\}/);
        expect(tab).toMatch(/<ClassSpecIcon iconUrl=\{r\.specIconUrl\} \/>/);
        // "Alle" and "Keiner" exist, so a council does not click twelve times.
        expect(tab).toMatch(/onClick=\{\(\) => patch\(\{ cmpOff: \[\] \}\)\}/);
        expect(tab).toMatch(/onClick=\{\(\) => patch\(\{ cmpOff: roster\.map\(\(r\) => r\.key\) \}\)\}/);
    });

    it("builds the matrix from the roster's own item lists, never a second request", () => {
        const build = fn("buildCompare");
        expect(build).toMatch(/for \(const it of r\.items\)/);
        // One row per item *and* raid, and every award of it per raider.
        expect(build).toMatch(/const rowKey = `\$\{cid\}:\$\{it\.itemId\}`;/);
        expect(page).toMatch(/awards: Map<string, CouncilLootItem\[\]>;/);
        expect(page).not.toMatch(/getLootCompare|\/api\/lootcouncil\/compare/);
    });

    it("groups rows by raid in the filter's order and orders them like a character sheet", () => {
        expect(page).toMatch(/const SHEET_ORDER = \[0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17\];/);
        const build = fn("buildCompare");
        expect(build).toMatch(/group\.rows\.sort\(\(a, b\) => slotRank\(a\.slot\) - slotRank\(b\.slot\) \|\| a\.name\.localeCompare\(b\.name\)\)/);
        // An unknown raid goes last rather than into a wrong one.
        expect(build).toMatch(/order\.get\(a\.contentId\) \?\? contents\.length/);
        // The raid is a row of its own above its items.
        const tab = fn("CompareTab");
        expect(tab).toMatch(/<tr className="lc-cmpgroup">/);
        expect(tab).toMatch(/<ContentBadge contentId=\{group\.contentId\} tier=\{group\.tier\} \/>/);
    });

    it("carries the slot on every awarded item, from the server", () => {
        // The order needs the slot, and only the server's item table knows it.
        expect(api).toMatch(/export type CouncilLootItem = \{[\s\S]*?slot: number;\s*slotName: string;[\s\S]*?\};/);
    });

    it("keeps the item column sticky and shares the BiS matrix's table", () => {
        const tab = fn("CompareTab");
        expect(tab).toMatch(/<table className="idx lc-blmatrix lc-cmpmatrix">/);
        expect(tab).toMatch(/<th scope="row" className="lc-blslot lc-cmpitem">/);
        // .lc-blslot is the sticky first column; the compare item cell only
        // widens and un-uppercases it.
        expect(rule(".lc-blcorner, .lc-blslot")).toMatch(/position: sticky/);
        expect(rule(".lc-blslot.lc-cmpitem, .lc-blcorner.lc-cmpitem")).toMatch(/text-transform: none/);
    });

    it("says why an empty cell matters instead of leaving it blank", () => {
        const cell = fn("CompareCell");
        expect(cell).toMatch(/raider\.bis\.items\.find\(\(b\) => b\.id === row\.itemId\)/);
        expect(cell).toMatch(/entry\.owned \? "trägt es" : "BiS offen"/);
        // A received item is tinted, an open one outlined — the row reads as a
        // pattern before anyone reads a date.
        expect(cell).toMatch(/className="lc-blcell lc-cmpcell got"/);
        expect(rule(".lc-cmpcell.got")).toMatch(/background/);
        expect(rule(".lc-cmpcell.wants")).toMatch(/box-shadow/);
        // Date and reason per award, so two rings are two lines.
        expect(cell).toMatch(/awards\.map\(\(a, i\) =>/);
        expect(cell).toMatch(/<ReasonBadge label=\{a\.reasonLabel\} tone=\{a\.reasonTone\} title=\{a\.reason\} \/>/);
    });
});
