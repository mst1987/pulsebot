const {
    STEP_MS, analyzeFightSeries, bucketCount, seriesPoints, totalSeries, asRate, resample, hpPctOf, bossActors, bossHpSeries,
} = require("../../../src/utils/logcheck/fightSeries.js");

const fight = (over = {}) => ({ id: 3, startTime: 100000, endTime: 160000, duration: 60000, kill: false, ...over });

describe("logcheck/fightSeries — bucketing", () => {
    it("has a bucket per 5 s, start and end inclusive (a 10-minute fight = 121 values)", () => {
        expect(STEP_MS).toBe(5000);
        expect(bucketCount(600000)).toBe(121);
        expect(bucketCount(60000)).toBe(13);
        expect(bucketCount(4999)).toBe(1);
        expect(bucketCount(0)).toBe(1);
    });

    it("puts a point at 0.5 s and 4.9 s in the first bucket and one at 5.0 s in the second", () => {
        // three points on a 100 ms grid → their bucket is what the time says
        const series = { pointStart: 100000 + 500, pointInterval: 4400, data: [10, 30, 100] }; // 0.5 s, 4.9 s, 9.3 s
        const out = resample(series, fight({ duration: 10000 }));
        expect(out).toEqual([20, 100, 100]); // [avg(10,30), 100, held]
        const exact = { pointStart: 100000, pointInterval: 5000, data: [1, 2, 3] }; // 0 s, 5.0 s, 10 s
        expect(resample(exact, fight({ duration: 10000 }))).toEqual([1, 2, 3]);
    });

    it("averages a finer WCL grid into the buckets and holds a coarser one", () => {
        const fine = { pointStart: 100000, pointInterval: 1000, data: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100] };
        expect(resample(fine, fight({ duration: 10000 }))).toEqual([300, 800, 1100]);
        const coarse = { pointStart: 100000, pointInterval: 15000, data: [100, 400] };
        expect(resample(coarse, fight({ duration: 20000 }))).toEqual([100, 100, 100, 400, 400]);
    });

    it("takes the first point for buckets before the series starts and rounds", () => {
        const late = { pointStart: 100000 + 12000, pointInterval: 1000, data: [7.4, 7.6] };
        expect(resample(late, fight({ duration: 15000 }))).toEqual([7, 7, 8, 8]);
        expect(resample({ pointStart: 100000, pointInterval: 1000, data: [] }, fight({ duration: 10000 }))).toEqual([0, 0, 0]);
    });
});

describe("logcheck/fightSeries — reading the WCL graph", () => {
    it("prefers the Total series and otherwise sums the sources on their shared grid", () => {
        const withTotal = { data: { series: [
            { name: "Alice", pointStart: 0, pointInterval: 1000, total: 4, data: [1, 3] },
            { name: "Total", pointStart: 0, pointInterval: 1000, total: 9, data: [4, 5] },
        ] } };
        expect(totalSeries(withTotal)).toEqual({ pointStart: 0, pointInterval: 1000, total: 9, data: [4, 5] });

        const perSource = { data: { series: [
            { name: "Alice", pointStart: 1000, pointInterval: 1000, total: 4, data: [1, 3] },
            { name: "Bob", pointStart: 0, pointInterval: 1000, total: 6, data: [2, 2, 2] },
            { name: "Odd", pointStart: 0, pointInterval: 2000, total: 99, data: [50] }, // other grid: skipped
        ] } };
        expect(totalSeries(perSource)).toEqual({ pointStart: 0, pointInterval: 1000, total: 10, data: [2, 3, 5] });
    });

    it("yields nothing for an empty or malformed graph", () => {
        expect(totalSeries(null)).toBeNull();
        expect(totalSeries({ data: { series: [] } })).toBeNull();
        expect(totalSeries({ data: { series: [{ name: "x", pointStart: 0, pointInterval: 0, data: [1] }] } })).toBeNull();
        expect(seriesPoints({ data: [[NaN, 1]] })).toBeNull();
        expect(seriesPoints({ data: [[5000, 1]] })).toBeNull(); // one pair, no interval to be had
    });

    // WCL hands the graph points out in two shapes: a flat list on the
    // pointStart/pointInterval grid, or Highcharts-style [timestamp, value] pairs.
    it("reads [timestamp, value] pairs by their own x, not by an assumed grid", () => {
        const flat = seriesPoints({ pointStart: 1000, pointInterval: 500, data: [1, 2] });
        expect(flat).toEqual({ pairs: false, pointStart: 1000, pointInterval: 500, times: [1000, 1500], values: [1, 2] });
        // pairs with a gap in them: the x wins, the interval comes from the first gap
        const pairs = seriesPoints({ data: [[1000, 4], [2000, "5"], [4000, 6]] });
        expect(pairs).toEqual({ pairs: true, pointStart: 1000, pointInterval: 1000, times: [1000, 2000, 4000], values: [4, 5, 6] });
        // a declared interval is kept even when the pairs say otherwise; a broken pair is dropped
        expect(seriesPoints({ pointInterval: 500, data: [[1000, 4], ["x", 9], [4000, 6]] })).toEqual({ pairs: true, pointStart: 1000, pointInterval: 500, times: [1000, 4000], values: [4, 6] });

        const withTotal = { data: { series: [
            { name: "Total", pointStart: 0, pointInterval: 1000, total: 9, data: [[0, 4], [1000, 5]] },
        ] } };
        expect(totalSeries(withTotal)).toEqual({ pointStart: 0, pointInterval: 1000, total: 9, data: [4, 5], times: [0, 1000] });

        // per-source pairs are summed by their timestamp; a flat series on the same grid joins in
        const perSource = { data: { series: [
            { name: "Alice", pointStart: 1000, pointInterval: 1000, total: 4, data: [[1000, 1], [3000, 3]] },
            { name: "Bob", pointStart: 0, pointInterval: 1000, total: 6, data: [2, 2, 2] },
        ] } };
        expect(totalSeries(perSource)).toEqual({ pointStart: 0, pointInterval: 1000, total: 10, data: [2, 3, 2, 3], times: [0, 1000, 2000, 3000] });
    });

    it("resamples by the explicit times when the series carries them", () => {
        // three points at 0.5 s, 4.9 s and 9.3 s — the same buckets as the grid test above, but placed by x
        const series = { pointStart: 0, pointInterval: 1, times: [100500, 104900, 109300], data: [10, 30, 100] };
        expect(resample(series, fight({ duration: 10000 }))).toEqual([20, 100, 100]);
        // a times list that does not match the data falls back to the grid
        const odd = { pointStart: 100000, pointInterval: 5000, times: [1], data: [1, 2, 3] };
        expect(resample(odd, fight({ duration: 10000 }))).toEqual([1, 2, 3]);
    });

    it("calibrates the unit against the series total: per-bin amounts become a rate, rates stay", () => {
        // 5-s bins, 1000 damage in each → 200 DPS; the total says the values are amounts
        expect(asRate({ pointInterval: 5000, total: 3000, data: [1000, 1000, 1000] })).toEqual([200, 200, 200]);
        // the same total with values that already are the rate
        expect(asRate({ pointInterval: 5000, total: 3000, data: [200, 200, 200] })).toEqual([200, 200, 200]);
        // no total: taken as the rate the chart shows
        expect(asRate({ pointInterval: 5000, total: NaN, data: [7, 8] })).toEqual([7, 8]);
    });
});

describe("logcheck/fightSeries — boss health", () => {
    const bosses = [{ id: 20, name: "Gruul" }];

    it("reads hit points from the resource object of the event's own side only", () => {
        const ev = { sourceID: 20, targetID: 5, sourceResources: { hitPoints: 250, maxHitPoints: 1000 }, targetResources: { hitPoints: 1, maxHitPoints: 2 } };
        expect(hpPctOf(ev, 20)).toBe(25);
        expect(hpPctOf(ev, 5)).toBe(50);
        expect(hpPctOf(ev, 7)).toBeNull();
        expect(hpPctOf({ sourceID: 20, sourceResources: { hitPoints: 5, maxHitPoints: 0 } }, 20)).toBeNull();
        expect(hpPctOf({ sourceID: 20 }, 20)).toBeNull();
    });

    // The other shape includeResources produces: hitPoints/maxHitPoints on the
    // event itself next to classResources, resourceActor saying whose (1 = source).
    it("reads hit points from the event's top-level fields, following resourceActor", () => {
        const onSource = { sourceID: 20, targetID: 5, hitPoints: 300, maxHitPoints: 1000, classResources: [{ type: 0, amount: 1, max: 2 }] };
        expect(hpPctOf(onSource, 20)).toBe(30);
        expect(hpPctOf(onSource, 5)).toBeNull(); // the numbers are the source's, not the target's
        expect(hpPctOf({ ...onSource, resourceActor: 1 }, 20)).toBe(30);
        const onTarget = { sourceID: 5, targetID: 20, resourceActor: 2, hitPoints: 100, maxHitPoints: 1000 };
        expect(hpPctOf(onTarget, 20)).toBe(10);
        expect(hpPctOf(onTarget, 5)).toBeNull();
        // the resource object of the event's own side still wins when present
        expect(hpPctOf({ sourceID: 20, hitPoints: 300, maxHitPoints: 1000, sourceResources: { hitPoints: 250, maxHitPoints: 1000 } }, 20)).toBe(25);
        // ...and a useless object falls through to the top-level fields
        expect(hpPctOf({ sourceID: 20, hitPoints: 300, maxHitPoints: 1000, sourceResources: {} }, 20)).toBe(30);
        // an event of the boss's own side with top-level hit points feeds the series like the object shape
        const events = [
            { timestamp: 100000, sourceID: 20, hitPoints: 1000, maxHitPoints: 1000 },
            { timestamp: 105000, sourceID: 20, hitPoints: 400, maxHitPoints: 1000 },
        ];
        expect(bossHpSeries(events, bosses, fight({ duration: 5000 })).bossHp).toEqual([100, 40]);
    });

    it("names the fight's bosses from v1's enemy list", () => {
        const fights = { enemies: [
            { id: 20, name: "Gruul", type: "Boss", fights: [{ id: 3 }] },
            { id: 21, name: "Lair Brute", type: "NPC", fights: [{ id: 3 }] },
            { id: 22, name: "Maulgar", type: "Boss", fights: [{ id: 1 }] },
            { id: 23, name: "Krosh", type: "Boss" }, // no fight list: taken along
        ] };
        expect(bossActors(fights, 3)).toEqual([{ id: 20, name: "Gruul" }, { id: 23, name: "Krosh" }]);
        expect(bossActors({}, 3)).toEqual([]);
    });

    it("falls monotonically within a phase, holding the last sample across empty buckets", () => {
        const events = [
            { timestamp: 100000 + 1000, sourceID: 20, sourceResources: { hitPoints: 990, maxHitPoints: 1000 } },
            { timestamp: 100000 + 4000, sourceID: 20, sourceResources: { hitPoints: 950, maxHitPoints: 1000 } },
            { timestamp: 100000 + 12000, sourceID: 20, sourceResources: { hitPoints: 800, maxHitPoints: 1000 } },
            { timestamp: 100000 + 26000, sourceID: 20, sourceResources: { hitPoints: 500, maxHitPoints: 1000 } },
        ];
        const out = bossHpSeries(events, bosses, fight({ duration: 30000 }));
        // bucket k is drawn at k × 5 s and shows the last sample up to then: the
        // 1 s and 4 s samples both belong to the 5 s point (the later wins), the
        // 12 s one to the 15 s point, the 26 s one to the 30 s point; the 0 s
        // point takes the first sample rather than an assumed 100 %
        expect(out.bossHp).toEqual([95, 95, 95, 80, 80, 80, 50]);
        for (let i = 1; i < out.bossHp.length; i++) expect(out.bossHp[i]).toBeLessThanOrEqual(out.bossHp[i - 1]);
        expect(out.targets).toEqual([{ id: 20, name: "Gruul", hp: [95, 95, 95, 80, 80, 80, 50] }]);
    });

    it("ends at 0 on a kill, never before, and ignores events outside the fight", () => {
        const events = [
            { timestamp: 99000, sourceID: 20, sourceResources: { hitPoints: 1000, maxHitPoints: 1000 } }, // before the pull
            { timestamp: 100000 + 5000, sourceID: 20, sourceResources: { hitPoints: 600, maxHitPoints: 1000 } },
            { timestamp: 100000 + 9000, sourceID: 20, sourceResources: { hitPoints: 30, maxHitPoints: 1000 } },
            { timestamp: 100000 + 11000, sourceID: 20, sourceResources: { hitPoints: 1, maxHitPoints: 1000 } }, // after the end
        ];
        expect(bossHpSeries(events, bosses, fight({ duration: 10000, kill: true })).bossHp).toEqual([60, 60, 0]);
        expect(bossHpSeries(events, bosses, fight({ duration: 10000, kill: false })).bossHp).toEqual([60, 60, 3]);
    });

    it("averages a council over its bosses and keeps each boss's own line", () => {
        const council = [{ id: 20, name: "Maulgar" }, { id: 21, name: "Krosh" }, { id: 22, name: "Olm" }];
        const events = [
            { timestamp: 100000, sourceID: 20, sourceResources: { hitPoints: 100, maxHitPoints: 100 } },
            { timestamp: 100000, sourceID: 21, sourceResources: { hitPoints: 100, maxHitPoints: 100 } },
            { timestamp: 100000 + 5000, sourceID: 21, sourceResources: { hitPoints: 20, maxHitPoints: 100 } },
            { timestamp: 100000 + 5000, sourceID: 20, sourceResources: { hitPoints: 80, maxHitPoints: 100 } },
        ];
        const out = bossHpSeries(events, council, fight({ duration: 5000 }));
        expect(out.bossHp).toEqual([100, 50]);
        // Olm was never sampled: left out rather than drawn at a made-up level
        expect(out.targets.map((t) => t.name)).toEqual(["Maulgar", "Krosh"]);
        expect(out.targets[1].hp).toEqual([100, 20]);
    });

    it("is null when no event carries hit points", () => {
        expect(bossHpSeries([{ timestamp: 100000, sourceID: 20 }], bosses, fight())).toBeNull();
        expect(bossHpSeries([], [], fight())).toBeNull();
    });
});

describe("logcheck/fightSeries — analyzeFightSeries", () => {
    const fights = { enemies: [{ id: 20, name: "Gruul", type: "Boss", fights: [{ id: 3 }] }] };
    const timeline = () => ({ fights: [fight({ duration: 10000, endTime: 110000 }), fight({ id: 4, startTime: 200000, endTime: 205000, duration: 5000, kill: true })] });

    function client(responses) {
        return { isConfigured: () => true, getFightSeries: jest.fn(async (reportId, fightId) => responses[fightId] || null) };
    }

    it("does nothing without a configured client and leaves the timeline untouched", async () => {
        const tl = timeline();
        expect(await analyzeFightSeries(null, "abc", fights, tl)).toBeNull();
        expect(await analyzeFightSeries({ isConfigured: () => false, getFightSeries: jest.fn() }, "abc", fights, tl)).toBeNull();
        expect(tl.fights[0].series).toBeUndefined();
        expect(await analyzeFightSeries(client({}), "abc", fights, null)).toBeNull();
        expect(await analyzeFightSeries(client({}), "abc", fights, { fights: [] })).toBeNull();
    });

    it("writes { step, dps, hps, bossHp } of equal length into every fight it could fetch", async () => {
        const tl = timeline();
        const wcl = client({
            3: {
                damage: { data: { series: [{ name: "Total", pointStart: 100000, pointInterval: 5000, total: 3000, data: [1000, 1000, 1000] }] } },
                healing: { data: { series: [{ name: "Total", pointStart: 100000, pointInterval: 5000, total: 300, data: [100, 100, 100] }] } },
                enemyEvents: [
                    { timestamp: 100000, sourceID: 20, sourceResources: { hitPoints: 100, maxHitPoints: 100 } },
                    { timestamp: 109000, sourceID: 20, sourceResources: { hitPoints: 40, maxHitPoints: 100 } },
                ],
            },
        });
        const summary = await analyzeFightSeries(wcl, "abc", fights, tl);
        expect(wcl.getFightSeries).toHaveBeenCalledWith("abc", 3, 100000, 110000);
        expect(wcl.getFightSeries).toHaveBeenCalledWith("abc", 4, 200000, 205000);
        expect(tl.fights[0].series).toEqual({ step: 5000, dps: [200, 200, 200], hps: [20, 20, 20], bossHp: [100, 100, 40] });
        expect(tl.fights[0].series.dps).toHaveLength(bucketCount(10000));
        // the fight the API had nothing for stays without a series — no error
        expect(tl.fights[1].series).toBeNull();
        expect(summary).toEqual({ fights: 2, withSeries: 1, withBossHp: 1, withPlayers: 0 });
    });

    it("draws a graph that came as [timestamp, value] pairs on the same buckets", async () => {
        const tl = { fights: [fight({ duration: 10000, endTime: 110000 })] };
        const wcl = client({
            3: {
                // 5-s bins as pairs: 1000 damage each → 200 DPS, placed by x
                damage: { data: { series: [{ name: "Total", pointStart: 100000, pointInterval: 5000, total: 3000, data: [[100000, 1000], [105000, 1000], [110000, 1000]] }] } },
                healing: null,
                enemyEvents: [],
            },
        });
        await analyzeFightSeries(wcl, "abc", fights, tl);
        expect(tl.fights[0].series).toEqual({ step: 5000, dps: [200, 200, 200], hps: null, bossHp: null });
    });

    it("keeps bossHp null when the events carry no hit points, and survives a failing fetch", async () => {
        const tl = timeline();
        const wcl = {
            isConfigured: () => true,
            getFightSeries: jest.fn()
                .mockResolvedValueOnce({ damage: { data: { series: [{ name: "Total", pointStart: 100000, pointInterval: 5000, total: 30, data: [10, 10, 10] }] } }, healing: null, enemyEvents: [{ timestamp: 100000, sourceID: 20 }] })
                .mockRejectedValueOnce(new Error("boom")),
        };
        const summary = await analyzeFightSeries(wcl, "abc", fights, tl);
        expect(tl.fights[0].series).toEqual({ step: 5000, dps: [2, 2, 2], hps: null, bossHp: null });
        expect(tl.fights[1].series).toBeNull();
        expect(summary).toEqual({ fights: 2, withSeries: 1, withBossHp: 0, withPlayers: 0 });
    });

    it("names each boss's line on a council fight", async () => {
        const tl = { fights: [fight({ duration: 5000, endTime: 105000 })] };
        const council = { enemies: [
            { id: 20, name: "Maulgar", type: "Boss", fights: [{ id: 3 }] },
            { id: 21, name: "Krosh", type: "Boss", fights: [{ id: 3 }] },
        ] };
        const wcl = client({ 3: { damage: null, healing: null, enemyEvents: [
            { timestamp: 100000, sourceID: 20, sourceResources: { hitPoints: 100, maxHitPoints: 100 } },
            { timestamp: 105000, sourceID: 21, sourceResources: { hitPoints: 50, maxHitPoints: 100 } },
        ] } });
        await analyzeFightSeries(wcl, "abc", council, tl);
        expect(tl.fights[0].series).toEqual({
            step: 5000, dps: null, hps: null, bossHp: [75, 75],
            bossHpTargets: [{ id: 20, name: "Maulgar", hp: [100, 100] }, { id: 21, name: "Krosh", hp: [50, 50] }],
        });
    });
});

describe("logcheck/fightSeries — the players' own curves", () => {
    const { sourceSeries, playerSeries, dipShare, summarizeFightSeries } = require("../../../src/utils/logcheck/fightSeries.js");
    const idToPlayer = { 1: { name: "Alice", type: "Mage" }, 2: { name: "Bob", type: "Warlock" }, 3: { name: "Heal", type: "Priest" } };
    const src = (over) => ({ pointStart: 100000, pointInterval: 5000, total: NaN, ...over });

    it("maps the per-source series onto the roster by actor id and drops what it cannot place", () => {
        const graph = { data: { series: [
            src({ name: "Total", data: [500, 500, 500] }),
            src({ name: "Alice", id: 1, type: "Mage", data: [100, 200, 300] }),
            src({ name: "Renamed", id: 2, type: "Warlock", data: [50, 50, 50] }),   // id wins over the name
            src({ name: "Lair Brute", id: 77, type: "NPC", data: [10, 10, 10] }),   // not on the roster: dropped
            src({ name: "Zero", id: 3, type: "Priest", data: [0, 0, 0] }),          // did nothing: left out
        ] } };
        const out = sourceSeries(graph, idToPlayer, fight({ duration: 10000 }));
        expect([...out.keys()]).toEqual(["Alice", "Bob"]);
        expect(out.get("Alice")).toEqual({ type: "Mage", values: [100, 200, 300] });
        expect(out.get("Bob").values).toEqual([50, 50, 50]);
        expect(sourceSeries(graph, null, fight()).size).toBe(0);
        expect(sourceSeries(null, idToPlayer, fight()).size).toBe(0);
    });

    it("falls back to the name when the series carries no id, but never for a pet", () => {
        const graph = { data: { series: [
            src({ name: "Alice", data: [1, 1, 1] }),
            src({ name: "Bob", type: "Pet", data: [9, 9, 9] }),
        ] } };
        const out = sourceSeries(graph, idToPlayer, fight({ duration: 10000 }));
        expect([...out.keys()]).toEqual(["Alice"]);
    });

    it("adds a pet to its owner when the series names one, and calibrates per-bin amounts like the raid series", () => {
        const graph = { data: { series: [
            src({ name: "Bob", id: 2, total: 1500, data: [500, 500, 500] }),            // amounts per 5-s bin → 100/s
            src({ name: "Felguard", id: 55, type: "Pet", petOwner: 2, total: 300, data: [100, 100, 100] }),
            src({ name: "Imp", id: 56, type: "Pet", ownerID: 1, total: 150, data: [50, 50, 50] }),
            src({ name: "Stray", id: 57, type: "Pet", data: [1, 1, 1] }),               // no owner named: dropped
        ] } };
        const out = sourceSeries(graph, idToPlayer, fight({ duration: 10000 }));
        expect(out.get("Bob").values).toEqual([120, 120, 120]);
        expect(out.get("Alice")).toEqual({ type: "Mage", values: [10, 10, 10] });
        expect(out.size).toBe(2);
    });

    it("builds { name, type, dps?, hps? } per raider, hps only where there was any, sorted by name", () => {
        const fetched = {
            damage: { data: { series: [src({ name: "Bob", id: 2, data: [3, 3, 3] }), src({ name: "Alice", id: 1, data: [2, 2, 2] }), src({ name: "Heal", id: 3, data: [1, 0, 0] })] } },
            healing: { data: { series: [src({ name: "Heal", id: 3, data: [40, 40, 40] }), src({ name: "Alice", id: 1, data: [0, 0, 0] })] } },
        };
        expect(playerSeries(fetched, idToPlayer, fight({ duration: 10000 }))).toEqual([
            { name: "Alice", type: "Mage", dps: [2, 2, 2] },
            { name: "Bob", type: "Warlock", dps: [3, 3, 3] },
            { name: "Heal", type: "Priest", dps: [1, 0, 0], hps: [40, 40, 40] },
        ]);
        expect(playerSeries(fetched, null, fight())).toEqual([]);
    });

    it("writes the players next to the raid series through analyzeFightSeries, and the raid mean per player is the raid series over their count", async () => {
        const five = { 1: { name: "A" }, 2: { name: "B" }, 3: { name: "C" }, 4: { name: "D" }, 5: { name: "E" } };
        const perSource = [1, 2, 3, 4, 5].map((id) => src({ name: five[id].name, id, data: [100, 100, 100] }));
        const tl = { fights: [fight({ duration: 10000, endTime: 110000 })] };
        const wcl = { isConfigured: () => true, getFightSeries: jest.fn(async () => ({
            damage: { data: { series: [src({ name: "Total", data: [500, 500, 500] }), ...perSource] } }, healing: null, enemyEvents: [],
        })) };
        const summary = await analyzeFightSeries(wcl, "abc", { enemies: [] }, tl, five);
        const s = tl.fights[0].series;
        expect(s.dps).toEqual([500, 500, 500]);
        expect(s.players).toHaveLength(5);
        expect(s.players.map((p) => p.name)).toEqual(["A", "B", "C", "D", "E"]);
        expect(s.dps.map((v) => v / s.players.length)).toEqual([100, 100, 100]);
        expect(summary).toEqual({ fights: 1, withSeries: 1, withBossHp: 0, withPlayers: 1 });
        // without the roster map there is no players key at all — the old shape stays byte-for-byte
        const tl2 = { fights: [fight({ duration: 10000, endTime: 110000 })] };
        await analyzeFightSeries(wcl, "abc", { enemies: [] }, tl2);
        expect(tl2.fights[0].series).toEqual({ step: 5000, dps: [500, 500, 500], hps: null, bossHp: null });
    });

    it("counts the buckets below half the own mean, leaving out everything after the death", () => {
        // alive mean 100 → threshold 50: two of five buckets below; the zeros after the death at 25 s do not count
        expect(dipShare([100, 40, 100, 160, 100, 0, 0, 0], 5000, 25000)).toEqual({ pct: 20, below: 1, buckets: 5, mean: 100 });
        // without a death the zeros pull the mean down to 62.5 and count as dips themselves (40 is above 31.25)
        expect(dipShare([100, 40, 100, 160, 100, 0, 0, 0], 5000, null)).toEqual({ pct: 38, below: 3, buckets: 8, mean: 63 });
        expect(dipShare([0, 0, 0], 5000, null)).toBeNull();
        expect(dipShare([100, 100], 5000, 0)).toBeNull();
        expect(dipShare([], 5000, null)).toBeNull();
    });

    it("sums the dip share over the raid per raider on their own measure and sorts the worst first", () => {
        const tl = { fights: [
            { id: 1, deaths: [{ name: "Alice", at: 10000 }], series: { step: 5000, players: [
                { name: "Alice", type: "Mage", dps: [100, 100, 0, 0] },              // alive: 2 buckets, no dip
                { name: "Bob", type: "Warlock", dps: [100, 10, 10, 100] },           // 2 of 4 below
                { name: "Heal", type: "Priest", dps: [10, 10, 10, 10], hps: [200, 200, 20, 200] },
            ] } },
            { id: 2, deaths: [], series: { step: 5000, players: [
                { name: "Bob", type: "Warlock", dps: [100, 100, 100, 10] },          // 1 of 4 below
            ] } },
            { id: 3, deaths: [], series: null },
        ] };
        const out = summarizeFightSeries(tl);
        expect(out.players).toEqual([
            { name: "Bob", type: "Warlock", measure: "dps", fights: 2, dipPct: 38, avgDps: 66, avgHps: 0 },
            { name: "Heal", type: "Priest", measure: "hps", fights: 1, dipPct: 25, avgDps: 10, avgHps: 155 },
            { name: "Alice", type: "Mage", measure: "dps", fights: 1, dipPct: 0, avgDps: 50, avgHps: 0 },
        ]);
        expect(summarizeFightSeries({ fights: [{ id: 1, series: { step: 5000, dps: [1] } }] })).toBeNull();
        expect(summarizeFightSeries(null)).toBeNull();
    });
});
