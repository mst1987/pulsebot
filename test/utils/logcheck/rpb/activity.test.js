const {
    analyzeActivity,
    sumCastSection,
    hasteSecondsFromBuffs,
} = require("../../../../src/utils/logcheck/rpb/activity");
const rpbData = require("../../../../src/config/rpbData");

const fights = {
    end: 10000,
    fights: [
        { id: 1, boss: 0, start_time: 0, end_time: 100_000 },       // 100s
        { id: 2, boss: 601, start_time: 100_000, end_time: 300_000 }, // 200s
    ],
};
// total tracked time = 300s

describe("rpb/activity sumCastSection", () => {
    const tracked = [
        { name: "Fireball", label: "Feuerball", ids: ["100", "101"], lowerRankIds: ["100"], castTime: 3 },
        { name: "Frostbolt", label: "Frostblitz", ids: ["200"], castTime: 2.5 },
        { name: "Faerie Fire (uptime%)", label: "Feenfeuer", ids: ["300"], castTime: 1.5, isUptime: true },
    ];

    test("multiplies casts by their base cast time", () => {
        const entries = [
            { guid: 101, total: 10 },
            { guid: 200, total: 4 },
        ];
        const { totalTime, rows } = sumCastSection(entries, tracked);
        expect(totalTime).toBe(10 * 3 + 4 * 2.5);
        expect(rows).toHaveLength(2);
    });

    test("sums several ids of the same tracked ability", () => {
        const entries = [{ guid: 100, total: 3 }, { guid: 101, total: 2 }];
        const { totalTime, rows } = sumCastSection(entries, tracked);
        expect(rows[0].amount).toBe(5);
        expect(totalTime).toBe(15);
    });

    test("flags an ability that was mostly cast at a lower rank", () => {
        const entries = [{ guid: 100, total: 8 }, { guid: 101, total: 2 }];
        const [row] = sumCastSection(entries, tracked).rows;
        expect(row.mostlyLowerRank).toBe(true);
    });

    test("does not flag when max rank dominates", () => {
        const entries = [{ guid: 100, total: 2 }, { guid: 101, total: 8 }];
        const [row] = sumCastSection(entries, tracked).rows;
        expect(row.mostlyLowerRank).toBeUndefined();
    });

    test("reports the exact downrank share, not just the 'mostly' flag", () => {
        const entries = [{ guid: 100, total: 3 }, { guid: 101, total: 7 }];
        const [row] = sumCastSection(entries, tracked).rows;
        expect(row.lowerRankCasts).toBe(3);
        expect(row.lowerRankPercent).toBe(30);
        expect(row.mostlyLowerRank).toBeUndefined();   // 30% is not "mostly"
    });

    test("an ability cast only at max rank carries no downrank fields at all", () => {
        const entries = [{ guid: 101, total: 5 }];
        const [row] = sumCastSection(entries, tracked).rows;
        expect(row.lowerRankCasts).toBeUndefined();
        expect(row.lowerRankPercent).toBeUndefined();
    });

    test("prefers the max rank's icon even when a lower rank was cast more often", () => {
        const entries = [
            { guid: 100, total: 9, abilityIcon: "rank1.jpg" },
            { guid: 101, total: 1, abilityIcon: "rankmax.jpg" },
        ];
        const [row] = sumCastSection(entries, tracked).rows;
        expect(row.icon).toBe("rankmax.jpg");
        expect(row.spellId).toBe(101);
        expect(row.mostlyLowerRank).toBe(true);
    });

    test("falls back to the used rank's icon when no max rank was cast", () => {
        const entries = [{ guid: 100, total: 4, abilityIcon: "rank1.jpg" }];
        const [row] = sumCastSection(entries, tracked).rows;
        expect(row.icon).toBe("rank1.jpg");
        expect(row.spellId).toBe(100);
    });

    test("uptime abilities report an average uptime percentage", () => {
        const entries = [{ guid: 300, total: 4, uptime: 320 }];
        const rows = sumCastSection(entries, tracked).rows;
        expect(rows[0].uptimePercent).toBe(80);
    });

    test("abilities that never happened are dropped", () => {
        expect(sumCastSection([], tracked).rows).toEqual([]);
        expect(sumCastSection(null, tracked).totalTime).toBe(0);
    });
});

describe("rpb/activity hasteSecondsFromBuffs", () => {
    const bloodlust = rpbData.HASTE_BUFFS.find((b) => b.key === "bloodlust");
    const icyVeins = rpbData.HASTE_BUFFS.find((b) => b.key === "icyVeins");

    test("counts casts of a haste effect", () => {
        const { seconds, used } = hasteSecondsFromBuffs([{ guid: Number(bloodlust.ids[0]), total: 2 }], []);
        expect(seconds).toBe(2 * bloodlust.seconds);
        expect(used.bloodlust).toBe(2);
    });

    test("counts buff uses from the aura table", () => {
        const { seconds } = hasteSecondsFromBuffs([], [{ guid: Number(icyVeins.ids[0]), totalUses: 3 }]);
        expect(seconds).toBe(3 * icyVeins.seconds);
    });

    test("falls back to band count when totalUses is missing", () => {
        const { used } = hasteSecondsFromBuffs([], [{ guid: Number(icyVeins.ids[0]), bands: [{}, {}] }]);
        expect(used.icyVeins).toBe(2);
    });

    test("unrelated spells contribute nothing", () => {
        expect(hasteSecondsFromBuffs([{ guid: 424242, total: 99 }], []).seconds).toBe(0);
    });
});

describe("rpb/activity analyzeActivity", () => {
    // pick a real tracked mage cast so the class lookup resolves
    const mageCast = rpbData.SINGLE_TARGET_CASTS.Mage.find((c) => c.castTime);
    const players = [{ id: 1, name: "Mage", type: "Mage" }];

    test("computes seconds active and the share of raid time", () => {
        const tables = {
            Mage: { casts: { entries: [{ guid: Number(mageCast.ids[0]), total: 30 }] } },
        };
        const result = analyzeActivity(fights, players, tables, {});
        expect(result.raidSeconds).toBe(300);
        const row = result.players[0];
        expect(row.secondsActive).toBe(Math.round(30 * mageCast.castTime));
        expect(row.relativeTotal).toBe(Math.round((row.secondsActiveST / 300) * 100));
    });

    test("gear spell haste shortens the computed active time", () => {
        const tables = { Mage: { casts: { entries: [{ guid: Number(mageCast.ids[0]), total: 30 }] } } };
        const plain = analyzeActivity(fights, players, tables, {}).players[0];
        const hasted = analyzeActivity(fights, players, tables, { Mage: 157.7 }).players[0];
        expect(hasted.secondsActive).toBeLessThan(plain.secondsActive);
        expect(hasted.gearSpellHaste).toBe(157.7);
    });

    test("haste effects are subtracted from the active time", () => {
        const bloodlust = rpbData.HASTE_BUFFS.find((b) => b.key === "bloodlust");
        const tables = {
            Mage: {
                casts: { entries: [{ guid: Number(mageCast.ids[0]), total: 30 }] },
                buffs: { auras: [{ guid: Number(bloodlust.ids[0]), totalUses: 2 }] },
            },
        };
        const row = analyzeActivity(fights, players, tables, {}).players[0];
        expect(row.hasteSecondsSubtracted).toBe(2 * bloodlust.seconds);
        expect(row.secondsActive).toBe(Math.round(30 * mageCast.castTime - 2 * bloodlust.seconds));
    });

    test("never reports negative activity", () => {
        const bloodlust = rpbData.HASTE_BUFFS.find((b) => b.key === "bloodlust");
        const tables = {
            Mage: {
                casts: { entries: [{ guid: Number(mageCast.ids[0]), total: 1 }] },
                buffs: { auras: [{ guid: Number(bloodlust.ids[0]), totalUses: 50 }] },
            },
        };
        const row = analyzeActivity(fights, players, tables, {}).players[0];
        expect(row.secondsActive).toBe(0);
        expect(row.relativeTotal).toBe(0);
    });

    test("players without a fetched cast table are skipped", () => {
        expect(analyzeActivity(fights, players, {}, {})).toBeNull();
    });

    test("no players returns null", () => {
        expect(analyzeActivity(fights, [], {}, {})).toBeNull();
    });

    test("sorts by relative activity descending", () => {
        const two = [
            { id: 1, name: "Busy", type: "Mage" },
            { id: 2, name: "Idle", type: "Mage" },
        ];
        const tables = {
            Busy: { casts: { entries: [{ guid: Number(mageCast.ids[0]), total: 50 }] } },
            Idle: { casts: { entries: [{ guid: Number(mageCast.ids[0]), total: 5 }] } },
        };
        const result = analyzeActivity(fights, two, tables, {});
        expect(result.players.map((p) => p.name)).toEqual(["Busy", "Idle"]);
    });
});
