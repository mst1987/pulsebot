const fixture = require("../../fixtures/wcl/fight-timeline.json");
const {
    analyzeFightTimeline, clipBands, mergeBands, gapsBetween, stackBands, deathsForFight,
} = require("../../../src/utils/logcheck/fightTimeline");
const { fight: gruulFight } = require("../../factories/wcl");

const GRUUL = fixture.fights.fights[2];

describe("clipBands", () => {
    it("makes WCL aura bands fight-relative and clips them to the fight", () => {
        const bands = clipBands(fixture.faerieFireBands, GRUUL.start_time, GRUUL.end_time);
        // the first band began before the pull, the last one is still up at the end
        expect(bands).toEqual([[0, 40000], [38000, 80000], [120000, 180000]]);
    });

    it("drops bands entirely outside the fight and accepts plain pairs", () => {
        expect(clipBands([[0, 50], [200, 300], [90, 110]], 100, 150)).toEqual([[0, 10]]);
    });

    it("ignores malformed entries", () => {
        expect(clipBands([null, {}, { startTime: "x" }, 5], 0, 100)).toEqual([]);
    });
});

describe("mergeBands", () => {
    it("merges overlapping and touching bands, keeps separate ones apart", () => {
        expect(mergeBands([[10, 20], [0, 5], [5, 8], [18, 30], [40, 50]])).toEqual([[0, 8], [10, 30], [40, 50]]);
    });

    it("drops empty and reversed bands", () => {
        expect(mergeBands([[5, 5], [9, 3], [1, 2]])).toEqual([[1, 2]]);
    });
});

describe("gapsBetween", () => {
    it("reports uptime, every gap including lead-in and tail, and the first application", () => {
        const g = gapsBetween([[10, 40], [35, 60], [80, 90]], 100);
        expect(g.uptimeMs).toBe(60);
        expect(g.uptimePct).toBe(60);
        expect(g.gaps).toEqual([[0, 10], [60, 80], [90, 100]]);
        expect(g.gapCount).toBe(3);
        expect(g.longestGap).toBe(20);
        expect(g.firstAt).toBe(10);
    });

    it("is one full gap and no first application when nothing was ever up", () => {
        expect(gapsBetween([], 50)).toEqual({
            uptimeMs: 0, uptimePct: 0, gaps: [[0, 50]], gapCount: 1, longestGap: 50, firstAt: null,
        });
    });

    it("has no gap when the band covers the whole fight", () => {
        const g = gapsBetween([[0, 100]], 100);
        expect(g.gaps).toEqual([]);
        expect(g.uptimePct).toBe(100);
    });

    it("answers zeros for a zero-length fight", () => {
        expect(gapsBetween([[0, 10]], 0).uptimePct).toBe(0);
    });
});

describe("stackBands", () => {
    const fight = { start: GRUUL.start_time, end: GRUUL.end_time, maxStacks: 5 };

    it("follows the stack height through applies, refreshes and removal, and restarts at one", () => {
        const bands = stackBands(fixture.sunderEvents, fight);
        expect(bands).toEqual([
            { from: 2000, to: 3600, stacks: 1 },
            { from: 3600, to: 5100, stacks: 2 },
            { from: 5100, to: 6700, stacks: 3 },
            { from: 6700, to: 8200, stacks: 4 },
            // the refresh at 20 s keeps the height, the band runs on to the removal
            { from: 8200, to: 50000, stacks: 5 },
            { from: 61000, to: 62500, stacks: 1 },
            // still up when the fight ends: runs to the end
            { from: 62500, to: 180000, stacks: 2 },
        ]);
    });

    it("caps the height at maxStacks and counts an apply without a stack field as one", () => {
        const bands = stackBands([
            { timestamp: 300000, type: "applydebuff" },
            { timestamp: 301000, type: "applydebuffstack", stack: 9 },
        ], fight);
        expect(bands.map((b) => b.stacks)).toEqual([1, 5]);
    });

    it("treats a stream that starts with a refresh as one stack from then on", () => {
        const bands = stackBands([{ timestamp: 310000, type: "refreshdebuff" }], fight);
        expect(bands).toEqual([{ from: 10000, to: 180000, stacks: 1 }]);
    });

    it("ignores events after the fight and events without a timestamp", () => {
        const bands = stackBands([
            { timestamp: 300000, type: "applydebuff" },
            { type: "removedebuff" },
            { timestamp: 999999, type: "removedebuff" },
        ], fight);
        expect(bands).toEqual([{ from: 0, to: 180000, stacks: 1 }]);
    });

    it("clips a band that began before the fight", () => {
        const bands = stackBands([
            { timestamp: 290000, type: "applydebuff" },
            { timestamp: 305000, type: "removedebuff" },
        ], fight);
        expect(bands).toEqual([{ from: 0, to: 5000, stacks: 1 }]);
    });
});

describe("deathsForFight", () => {
    it("picks the fight's deaths by fight id, fight-relative and sorted", () => {
        const deaths = deathsForFight(fixture.deaths.entries, fixture.fights.fights[1], {});
        expect(deaths).toEqual([
            { at: 30000, name: "Aldra", type: "Mage", ability: "Arcane Explosion", abilityIcon: "spell_nature_wispsplode", abilityId: 33237 },
            { at: 115000, name: "Brokk", type: "Warrior", ability: "Whirlwind", abilityIcon: "ability_whirlwind", abilityId: 33238 },
        ]);
    });

    it("falls back to the time window when the table names no fight, and to the roster for names", () => {
        const entries = [{ id: 7, timestamp: 310000 }, { id: 8, timestamp: 50 }];
        const deaths = deathsForFight(entries, GRUUL, { 7: { name: "Cyra", type: "Rogue" } });
        expect(deaths).toEqual([{ at: 10000, name: "Cyra", type: "Rogue", ability: "", abilityIcon: "", abilityId: null }]);
    });
});

describe("analyzeFightTimeline", () => {
    const wcl = () => ({ getDeaths: jest.fn(async () => fixture.deaths) });

    it("builds one row per boss fight with bounds, deaths and empty topic containers", async () => {
        const client = wcl();
        const result = await analyzeFightTimeline(client, "abc", fixture.fights, {});

        expect(client.getDeaths).toHaveBeenCalledTimes(1);
        expect(client.getDeaths).toHaveBeenCalledWith("abc", 0, 900000);
        expect(result.fights).toHaveLength(2);
        const [maulgar, gruul] = result.fights;
        expect(maulgar).toMatchObject({
            id: 2, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: false,
            startTime: 100000, endTime: 220000, duration: 120000, fightPercentage: 32.5,
            debuffs: null, totems: null, cooldowns: null, activity: null, buffs: null,
        });
        expect(maulgar.deaths.map((d) => d.name)).toEqual(["Aldra", "Brokk"]);
        expect(gruul).toMatchObject({ id: 3, kill: true, fightPercentage: 0, duration: 180000 });
        expect(gruul.deaths).toEqual([
            { at: 102000, name: "Aldra", type: "Mage", ability: "Shatter", abilityIcon: "spell_frost_glacier", abilityId: 33671 },
        ]);
    });

    it("is null without boss fights", async () => {
        const result = await analyzeFightTimeline(wcl(), "abc", { fights: [{ id: 1, boss: 0, name: "Trash" }] });
        expect(result).toBeNull();
    });

    it("skips a fight with no duration", async () => {
        const fights = { fights: [gruulFight({ id: 1, start_time: 10, end_time: 10 })] };
        expect(await analyzeFightTimeline(wcl(), "abc", fights)).toBeNull();
    });

    it("keeps the fights when the deaths call fails", async () => {
        const client = { getDeaths: jest.fn(async () => { throw new Error("boom"); }) };
        const result = await analyzeFightTimeline(client, "abc", fixture.fights);
        expect(result.fights).toHaveLength(2);
        expect(result.fights.every((f) => f.deaths.length === 0)).toBe(true);
    });

    it("leaves fightPercentage null when a wipe carries none", async () => {
        const fights = { fights: [gruulFight({ id: 1, kill: false, start_time: 0, end_time: 1000 })] };
        const result = await analyzeFightTimeline(wcl(), "abc", fights);
        expect(result.fights[0].fightPercentage).toBeNull();
    });
});
