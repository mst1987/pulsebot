// Pure fold over roster rows — nothing to mock, the input is the whole world.
const { rosterStats, classDistribution, MAX_CLASS_SEGMENTS } = require("../../src/web/rosterStats");

const char = (over = {}) => ({
    key: "anna",
    character: "Anna",
    categoryIds: ["cat1"],
    assigned: true,
    lootCount: 0,
    className: "Priest",
    classColor: "#ffffff",
    gear: null,
    ...over,
});

const gear = (issueCount, severities = []) => ({
    issueCount,
    issues: severities.map((severity, i) => ({ severity, itemId: i, kind: "enchant" })),
});

describe("web/rosterStats rosterStats", () => {
    it("returns a zeroed block for an empty roster", () => {
        expect(rosterStats([])).toEqual({
            total: 0, assigned: 0, fromLootOnly: 0,
            categories: 0, uncategorized: 0, loot: 0,
            evaluated: 0, withIssues: 0, clean: 0,
            issues: 0, highIssues: 0, classes: [],
        });
    });

    it("survives a missing/garbage roster instead of throwing", () => {
        expect(rosterStats(undefined).total).toBe(0);
        expect(rosterStats(null).classes).toEqual([]);
    });

    it("counts characters, assignments and the loot-only rest", () => {
        const stats = rosterStats([
            char({ key: "a", assigned: true }),
            char({ key: "b", assigned: true }),
            char({ key: "c", assigned: false }),
        ]);

        expect(stats).toMatchObject({ total: 3, assigned: 2, fromLootOnly: 1 });
    });

    it("counts distinct categories and the characters without one", () => {
        const stats = rosterStats([
            char({ key: "a", categoryIds: ["cat1", "cat2"] }),
            char({ key: "b", categoryIds: ["cat2"] }),
            char({ key: "c", categoryIds: [] }),
            char({ key: "d", categoryIds: undefined }),
        ]);

        expect(stats).toMatchObject({ categories: 2, uncategorized: 2 });
    });

    it("sums the loot count across the roster", () => {
        const stats = rosterStats([
            char({ key: "a", lootCount: 83 }),
            char({ key: "b", lootCount: 26 }),
            char({ key: "c", lootCount: 0 }),
            // a row from an older import may not carry the field at all
            char({ key: "d", lootCount: undefined }),
        ]);

        expect(stats.loot).toBe(109);
    });

    it("separates 'never evaluated' from 'evaluated without finding'", () => {
        const stats = rosterStats([
            char({ key: "a", gear: gear(0) }),
            char({ key: "b", gear: gear(2, ["high", "medium"]) }),
            char({ key: "c", gear: null }),
        ]);

        expect(stats).toMatchObject({
            total: 3,
            evaluated: 2,
            withIssues: 1,
            clean: 1,
            issues: 2,
            highIssues: 1,
        });
    });

    it("adds up every finding, not just the characters carrying them", () => {
        const stats = rosterStats([
            char({ key: "a", gear: gear(3, ["high", "high", "medium"]) }),
            char({ key: "b", gear: gear(1, ["medium"]) }),
        ]);

        expect(stats).toMatchObject({ withIssues: 2, issues: 4, highIssues: 2 });
    });

    it("tolerates a gear report without an issue list", () => {
        const stats = rosterStats([char({ gear: { issueCount: 2 } })]);

        expect(stats).toMatchObject({ evaluated: 1, withIssues: 1, issues: 2, highIssues: 0 });
    });
});

describe("web/rosterStats classDistribution", () => {
    it("groups by class, biggest first, keeping the row's own colour", () => {
        const dist = classDistribution([
            char({ key: "a", className: "Warlock", classColor: "#8787ed" }),
            char({ key: "b", className: "Hunter", classColor: "#abd473" }),
            char({ key: "c", className: "Warlock", classColor: "#8787ed" }),
        ]);

        expect(dist).toEqual([
            { className: "Warlock", classColor: "#8787ed", count: 2 },
            { className: "Hunter", classColor: "#abd473", count: 1 },
        ]);
    });

    it("breaks ties alphabetically so the strip does not reshuffle between loads", () => {
        const dist = classDistribution([
            char({ key: "a", className: "Rogue" }),
            char({ key: "b", className: "Druid" }),
            char({ key: "c", className: "Mage" }),
        ]);

        expect(dist.map((d) => d.className)).toEqual(["Druid", "Mage", "Rogue"]);
    });

    it("keeps classless characters as an explicit bucket, always last", () => {
        const dist = classDistribution([
            char({ key: "a", className: "" }),
            char({ key: "b", className: "  " }),
            char({ key: "c", className: "Mage" }),
        ]);

        expect(dist).toEqual([
            { className: "Mage", classColor: "#ffffff", count: 1 },
            { className: "Unbekannt", classColor: "", count: 2 },
        ]);
    });

    it("folds the tail past the segment cap into one 'Weitere' bucket", () => {
        // Two classes more than fit, each smaller than the one before, so the
        // fold hits exactly the two smallest.
        const total = MAX_CLASS_SEGMENTS + 2;
        const chars = [];
        for (let i = 0; i < total; i += 1) {
            const count = total - i;   // biggest first
            for (let k = 0; k < count; k += 1) chars.push(char({ key: `c${i}-${k}`, className: `Class${i}` }));
        }

        const dist = classDistribution(chars);

        expect(dist).toHaveLength(MAX_CLASS_SEGMENTS + 1);
        // the two smallest classes had 2 and 1 members
        expect(dist[dist.length - 1]).toEqual({ className: "Weitere", classColor: "", count: 3 });
        // Nothing is lost by folding — the segments still sum to the roster.
        expect(dist.reduce((n, d) => n + d.count, 0)).toBe(chars.length);
    });
});
