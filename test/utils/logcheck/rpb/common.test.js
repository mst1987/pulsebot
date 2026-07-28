const {
    ROLES,
    bossFights,
    trashFights,
    totalFightTime,
    roleForClass,
    collectFromSummaries,
    hasteDivisor,
    sumForIds,
    formatDuration,
} = require("../../../../src/utils/logcheck/rpb/common");

const fights = {
    end: 10000,
    fights: [
        { id: 1, boss: 0, start_time: 0, end_time: 1000 },        // trash
        { id: 2, boss: 601, start_time: 1000, end_time: 3000 },   // boss
        { id: 3, boss: 724, start_time: 3000, end_time: 5000 },   // Kalecgos -> excluded
        { id: 4, boss: 602, start_time: 5000, end_time: 6000 },   // boss
    ],
};

describe("rpb/common fight selection", () => {
    test("bossFights drops trash and the excluded encounter", () => {
        expect(bossFights(fights).map((f) => f.id)).toEqual([2, 4]);
    });

    test("trashFights only returns boss === 0", () => {
        expect(trashFights(fights).map((f) => f.id)).toEqual([1]);
    });

    test("totalFightTime sums all fights except Kalecgos", () => {
        // 1000 (trash) + 2000 + 1000 = 4000
        expect(totalFightTime(fights)).toBe(4000);
    });

    test("totalFightTime with bossesOnly skips trash", () => {
        expect(totalFightTime(fights, { bossesOnly: true })).toBe(3000);
    });

    test("empty fights list is handled", () => {
        expect(totalFightTime({})).toBe(0);
        expect(bossFights({})).toEqual([]);
    });
});

describe("rpb/common roleForClass", () => {
    test("classes with a single role need no counts", () => {
        expect(roleForClass("Hunter", {})).toBe("Physical");
        expect(roleForClass("Rogue", {})).toBe("Physical");
        expect(roleForClass("Mage", {})).toBe("Caster");
        expect(roleForClass("Warlock", {})).toBe("Caster");
    });

    test("druid picks the majority role", () => {
        expect(roleForClass("Druid", { healer: 5, tank: 1, dps: 0 })).toBe("Healer");
        expect(roleForClass("Druid", { healer: 0, tank: 4, dps: 1 })).toBe("Tank");
    });

    test("balance druid counts as caster, feral as physical", () => {
        expect(roleForClass("Druid", { dps: 5, dpsSpec: "Balance" })).toBe("Caster");
        expect(roleForClass("Druid", { dps: 5, dpsSpec: "Feral" })).toBe("Physical");
    });

    test("elemental shaman counts as caster, enhancement as physical", () => {
        expect(roleForClass("Shaman", { dps: 3, dpsSpec: "Elemental" })).toBe("Caster");
        expect(roleForClass("Shaman", { dps: 3, dpsSpec: "Enhancement" })).toBe("Physical");
        expect(roleForClass("Shaman", { healer: 4, dps: 1 })).toBe("Healer");
    });

    test("shadow priest counts as caster, otherwise healer", () => {
        expect(roleForClass("Priest", { dps: 4, healer: 1 })).toBe("Caster");
        expect(roleForClass("Priest", { dps: 0, healer: 4 })).toBe("Healer");
    });

    test("warrior defaults to tank unless dps dominates", () => {
        expect(roleForClass("Warrior", { dps: 5, tank: 1 })).toBe("Physical");
        expect(roleForClass("Warrior", { dps: 1, tank: 5 })).toBe("Tank");
    });

    test("paladin resolves healer/tank/physical", () => {
        expect(roleForClass("Paladin", { healer: 3 })).toBe("Healer");
        expect(roleForClass("Paladin", { tank: 3, dps: 1 })).toBe("Tank");
        expect(roleForClass("Paladin", { dps: 3, tank: 1 })).toBe("Physical");
    });

    test("unknown class falls back to Physical and every role is known", () => {
        expect(roleForClass("Deathknight", {})).toBe("Physical");
        expect(ROLES).toContain(roleForClass("Warrior", { tank: 1 }));
    });
});

describe("rpb/common collectFromSummaries", () => {
    test("counts roles across fights and keeps the reported dps spec", () => {
        const summaries = [
            { composition: [{ id: 7, specs: [{ role: "dps", spec: "Balance" }] }] },
            { composition: [{ id: 7, specs: [{ role: "dps", spec: "Balance" }] }] },
            { composition: [{ id: 7, specs: [{ role: "healer" }] }] },
        ];
        const { roleCounts } = collectFromSummaries(summaries);
        expect(roleCounts[7]).toEqual({ dps: 2, tank: 0, healer: 1, dpsSpec: "Balance" });
    });

    test("sums spell haste from items and gems, skipping shirt and tabard", () => {
        // 34340 -> 30 haste in the generated table; slot 3 (shirt) must be ignored
        const summaries = [{
            playerDetails: {
                dps: [{
                    name: "Mage",
                    combatantInfo: {
                        gear: [
                            { id: 34340, slot: 0, gems: [] },
                            { id: 34340, slot: 3, gems: [] },  // shirt -> skipped
                            { id: 1, slot: 5, gems: [{ id: 34340 }] },
                        ],
                    },
                }],
            },
        }];
        const { gearSpellHaste } = collectFromSummaries(summaries);
        expect(gearSpellHaste.Mage).toBe(60);
    });

    test("collects trinkets by name from slots 12 and 13", () => {
        const summaries = [{
            playerDetails: {
                dps: [{
                    name: "Mage",
                    combatantInfo: {
                        gear: [
                            { id: 100, slot: 12, name: "Skull" },
                            { id: 101, slot: 13, name: "Eye" },
                            { id: 102, slot: 4, name: "Chest" },
                        ],
                    },
                }],
            },
        }, {
            playerDetails: {
                dps: [{
                    name: "Mage",
                    combatantInfo: { gear: [{ id: 100, slot: 12, name: "Skull" }] },
                }],
            },
        }];
        const { trinkets } = collectFromSummaries(summaries);
        expect(trinkets.Mage).toEqual({ Skull: 2, Eye: 1 });
    });

    test("tolerates null summaries and missing sections", () => {
        const { roleCounts, gearSpellHaste, trinkets } = collectFromSummaries([null, {}, { composition: [] }]);
        expect(roleCounts).toEqual({});
        expect(gearSpellHaste).toEqual({});
        expect(trinkets).toEqual({});
    });
});

describe("rpb/common maths helpers", () => {
    test("hasteDivisor turns rating into a cast-time divisor", () => {
        expect(hasteDivisor(0)).toBe(1);
        // 15.77 rating = 1% haste -> divisor 1.01
        expect(hasteDivisor(15.77)).toBeCloseTo(1.01, 5);
        expect(hasteDivisor(157.7)).toBeCloseTo(1.1, 5);
    });

    test("sumForIds adds totals of matching guids only", () => {
        const entries = [
            { guid: 1, total: 5 },
            { guid: 2, total: 7 },
            { guid: 3, total: 9 },
        ];
        expect(sumForIds(entries, ["1", "3"])).toBe(14);
        expect(sumForIds(entries, [])).toBe(0);
        expect(sumForIds(null, ["1"])).toBe(0);
    });

    test("formatDuration renders hours, minutes and seconds", () => {
        expect(formatDuration(45_000)).toBe("45s");
        expect(formatDuration(125_000)).toBe("2m 5s");
        expect(formatDuration(3_725_000)).toBe("1h 2m");
    });
});
