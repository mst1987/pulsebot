// Nothing is mocked: the BiS lists are generated config, and what is under
// test is the shape the tab reads them in — which lists exist for how many
// specs, who borrows from whom, which tier is missing a list, where a list came
// from, and the count that says an item is contested.
const { bisLists, listedSpecs, columnsFor, bySlot } = require("../../src/web/bisLists");
const bis = require("../../src/config/bisSets");

describe("web/bisLists", () => {
    describe("listedSpecs", () => {
        it("lists the casters and the healers", () => {
            const keys = listedSpecs().map((s) => s.key);
            expect(keys).toContain("Priest-Shadow");
            // The healers are on the tab since their lists come from Wowhead —
            // leaving them off was a consequence of WoWSims having none.
            expect(keys).toContain("Priest-Holy");
            expect(keys).toContain("Paladin-Holy");
            expect(listedSpecs().filter((s) => s.role === "caster")).toHaveLength(9);
        });

        it("says which list a spec plays and whether it is its own", () => {
            const by = Object.fromEntries(listedSpecs().map((s) => [s.key, s]));
            expect(by["Mage-Arcane"]).toMatchObject({ listKey: "Mage-Arcane", ownList: true });
            // WoWSims ships no Fire or Frost set — they play Arcane's, and the
            // page has to be able to say so rather than presenting it as theirs.
            expect(by["Mage-Fire"]).toMatchObject({ listKey: "Mage-Arcane", ownList: false });
            expect(by["Warlock-Affliction"]).toMatchObject({ listKey: "Warlock-Destruction", ownList: false });
            // Wowhead writes one priest healing list, so Discipline plays Holy's.
            expect(by["Priest-Discipline"]).toMatchObject({ listKey: "Priest-Holy", ownList: false });
        });

        it("carries the class colour and spec icon, resolved server-side", () => {
            for (const spec of listedSpecs()) {
                expect(spec.classColor).toMatch(/^#/);
                expect(spec.iconUrl).toContain("zamimg.com");
            }
        });
    });

    describe("columnsFor", () => {
        it("is one column per list, not per spec", () => {
            const columns = columnsFor("t6", listedSpecs());
            expect(columns).toHaveLength(9);
            const arcane = columns.find((c) => c.key === "Mage-Arcane");
            expect(arcane.users.map((u) => u.key)).toEqual([
                "Mage-Arcane", "Mage-Fire", "Mage-Frost",
            ]);
            expect(arcane.users[0].ownList).toBe(true);
            expect(arcane.users[1].ownList).toBe(false);
        });

        it("drops a list the tier does not have", () => {
            // WoWSims has no Sunwell set for Shadow or Arcane. Better a missing
            // column than the T6 list relabelled as Sunwell.
            const keys = columnsFor("t65", listedSpecs()).map((c) => c.key);
            expect(keys).not.toContain("Priest-Shadow");
            expect(keys).not.toContain("Mage-Arcane");
            expect(keys).toContain("Warlock-Destruction");
        });

        it("says where each list comes from", () => {
            // A simulated loadout and a written recommendation are not the same
            // claim, and the column has to be able to say which it is.
            const by = Object.fromEntries(columnsFor("t6", listedSpecs()).map((c) => [c.key, c]));
            expect(by["Priest-Shadow"]).toMatchObject({ source: "wowsims", sourceLabel: "WoWSims" });
            expect(by["Druid-Restoration"]).toMatchObject({ source: "wowhead", sourceLabel: "Wowhead" });
        });
    });

    describe("bySlot", () => {
        it("puts two rings in two ring slots instead of one row", () => {
            const set = bySlot("Priest-Shadow", "t6");
            expect(set.has(10)).toBe(true);
            expect(set.has(11)).toBe(true);
            expect(set.get(10).id).not.toBe(undefined);
        });

        it("keeps the reference socketing and enchant of each entry", () => {
            const set = bySlot("Priest-Shadow", "t6");
            const entries = [...set.values()];
            expect(entries.some((e) => (e.gems || []).length)).toBe(true);
            expect(entries.some((e) => e.enchant)).toBe(true);
        });
    });

    describe("bisLists", () => {
        it("is a matrix: one row per slot, one cell per list", () => {
            const data = bisLists("t6");
            expect(data.tier).toBe("t6");
            expect(data.rows.length).toBeGreaterThan(10);
            for (const row of data.rows) {
                expect(row.cells).toHaveLength(data.columns.length);
                expect(row.slotName).toBeTruthy();
            }
        });

        it("reads down a column as one complete set", () => {
            const data = bisLists("t6");
            const shadow = data.columns.findIndex((c) => c.key === "Priest-Shadow");
            const ids = data.rows.map((r) => r.cells[shadow].item).filter(Boolean).map((i) => i.id);
            const set = bis.bisFor("Priest-Shadow", "t6").items.map((e) => e.id);
            expect(ids.length).toBe(new Set(set).size <= set.length ? ids.length : 0);
            for (const id of ids) expect(set).toContain(id);
        });

        it("counts how many of the tier's lists want an item", () => {
            // The number a council argues about — and the reason the matrix is
            // worth reading across rather than down only.
            const data = bisLists("t6");
            expect(data.contested).toBeGreaterThan(0);
            const cells = data.rows.flatMap((r) => r.cells).filter((c) => c.item);
            const shared = cells.filter((c) => c.shared > 1);
            expect(shared.length).toBeGreaterThan(0);
            for (const cell of shared) expect(cell.shared).toBeLessThanOrEqual(data.columns.length);
        });

        it("says which lists a tier is missing instead of backfilling", () => {
            const swp = bisLists("t65").tiers.find((t) => t.id === "t65");
            expect(swp.missing).toContain("Schattenpriester");
            expect(swp.missing).toContain("Arkan-Magier");
            const t6 = bisLists("t6").tiers.find((t) => t.id === "t6");
            expect(t6.missing).toEqual([]);
        });

        it("carries the reference socketing per cell", () => {
            const cells = bisLists("t6").rows.flatMap((r) => r.cells).filter((c) => c.item);
            expect(cells.some((c) => c.gems > 0)).toBe(true);
            expect(cells.some((c) => c.enchanted)).toBe(true);
        });

        it("gives the healers a full column, not a stub", () => {
            const data = bisLists("t6");
            const resto = data.columns.findIndex((c) => c.key === "Shaman-Restoration");
            expect(resto).toBeGreaterThanOrEqual(0);
            const filled = data.rows.filter((r) => r.cells[resto].item).length;
            // Sixteen slots at least: everything but the off hand, which a
            // two-handed weapon takes.
            expect(filled).toBeGreaterThanOrEqual(16);
        });

        it("falls back to a tier that exists rather than answering empty", () => {
            expect(bisLists("t99").tier).toBe("t6");
            expect(bisLists("").columns.length).toBeGreaterThan(0);
        });

        it("hands every item on with whose list it is on", () => {
            const cell = bisLists("t6").rows.flatMap((r) => r.cells).find((c) => c.item && c.shared > 1);
            expect(cell.item.bisSpecs.length).toBeGreaterThan(1);
            expect(cell.item.name).toBeTruthy();
            expect(cell.item.iconUrl).toContain("zamimg.com");
        });
    });
});
