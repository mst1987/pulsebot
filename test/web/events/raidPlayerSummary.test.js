const { summarizePlayers, RECENT_ITEMS } = require("../../../src/web/events/raidPlayerSummary");

const NOW = Date.UTC(2026, 8, 14, 12);
const DAY = 86400000;
const sec = (ms) => Math.floor(ms / 1000);

const raid = (daysAgo, names, categoryId = "cat1") => ({
    id: `r${daysAgo}`, categoryId, startTime: sec(NOW - daysAgo * DAY), setup: names.map((name) => ({ name })),
});
const item = (character, daysAgo, reason = "mainspec", extra = {}) => ({
    character, characterKey: character.toLowerCase(), itemId: 1, itemName: `Item ${daysAgo}`, reason, reasonLabel: reason,
    awardedAt: NOW - daysAgo * DAY, ...extra,
});

describe("summarizePlayers", () => {
    it("counts the category's raids in the window the raider was in", () => {
        const events = [raid(3, ["Nachtkralle", "Lumina"]), raid(10, ["Lumina"]), raid(70, ["Nachtkralle"]), raid(5, ["Nachtkralle"], "other")];
        const out = summarizePlayers(["nachtkralle", "Lumina"], [], events, { categoryId: "cat1", now: NOW });
        expect(out.nachtkralle).toMatchObject({ raids: 1, raidsOf: 2 });
        expect(out.lumina).toMatchObject({ raids: 2, raidsOf: 2 });
    });

    it("reports unknown raids as null, not as zero", () => {
        const events = [{ ...raid(3, []), setup: [] }];
        expect(summarizePlayers(["A"], [], events, { now: NOW }).a).toMatchObject({ raids: null, raidsOf: 0 });
    });

    it("ignores future raids", () => {
        const out = summarizePlayers(["A"], [], [raid(-2, ["A"])], { now: NOW });
        expect(out.a.raids).toBeNull();
    });

    it("counts only real loot, and lists the newest first", () => {
        const loot = [
            item("Lumina", 1, "disenchant"),
            item("Lumina", 4, "bis", { itemIconUrl: "icon", itemQuality: 4 }),
            item("Lumina", 20),
            item("Lumina", 90),
            item("Lumina", 100),
            item("Other", 2),
        ];
        const out = summarizePlayers(["Lumina"], loot, [], { now: NOW });
        expect(out.lumina.loot).toBe(2);
        expect(out.lumina.lastLootAt).toBe(NOW - 4 * DAY);
        expect(out.lumina.recent).toHaveLength(RECENT_ITEMS);
        expect(out.lumina.recent[0]).toMatchObject({ itemName: "Item 4", itemIconUrl: "icon", itemQuality: 4, reasonLabel: "bis" });
        expect(out.lumina.recent.map((r) => r.awardedAt)).toEqual([NOW - 4 * DAY, NOW - 20 * DAY, NOW - 90 * DAY]);
        expect(out.other).toBeUndefined();
    });

    it("skips blank names", () => {
        expect(Object.keys(summarizePlayers(["", "  ", "A"], [], [], { now: NOW }))).toEqual(["a"]);
    });
});
