// Guards for the "Item nachtragen" pickers
// (src/web-client/src/components/ManualLootForm.tsx).
//
// The item picker lists one raid's closed drop table; the raider picker lists an
// open-ended set of names. Only the second may be cut short — capping the first
// turned "Alle Bosse" into "the alphabetically first boss", because the
// catalogue arrives sorted by boss (src/web/lootCatalog.js's byBossThenName).
// There is no React renderer here, so what is checked is the source invariant.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const src = fs.readFileSync(path.join(CLIENT, "components", "ManualLootForm.tsx"), "utf8");
const css = fs.readFileSync(path.join(CLIENT, "index.css"), "utf8");

/** The body of one `function <name>(` … up to the next top-level `function`. */
function fn(name) {
    const start = src.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const end = rest.indexOf("\nfunction ");
    return end === -1 ? rest : rest.slice(0, end);
}

describe("manual loot pickers", () => {
    it("offers the raid's whole drop table, not a first page of it", () => {
        // The list is sorted by boss, so any cap hides whole bosses — with
        // "Alle Bosse" picked, everything past the first one disappeared.
        expect(fn("ItemPicker")).not.toMatch(/slice\(0,\s*MAX_SUGGESTIONS\)/);
        expect(fn("ItemPicker")).toContain("if (!q) return items;");
    });

    it("still narrows the item list by name or item id while typing", () => {
        expect(fn("ItemPicker")).toContain("norm(it.name).includes(q) || String(it.id) === q");
    });

    it("keeps the cap on the open-ended raider list", () => {
        // Every character that ever got loot — a "keep typing" hint is right there.
        expect(fn("RaiderPicker")).toMatch(/slice\(0,\s*MAX_SUGGESTIONS\)/);
    });

    // Showing every drop only works because the panel scrolls; without this it
    // would grow down the page and cover the rest of the form.
    it("scrolls the suggestion panel instead of growing it", () => {
        const panel = css.slice(css.indexOf(".hr-panel {"), css.indexOf(".hr-panel.open"));
        expect(panel).toMatch(/max-height:\s*\d+px/);
        expect(panel).toMatch(/overflow-y:\s*auto/);
    });
});
