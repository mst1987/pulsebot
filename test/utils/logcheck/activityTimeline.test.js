const {
    analyzeActivityTimeline, activityForFight, activityBands, findGaps, summarize, GCD_MS, MIN_GAP_MS,
} = require("../../../src/utils/logcheck/activityTimeline");
const { fight: gruulFight } = require("../../factories/wcl");

const START = 300000;
const fight = gruulFight({ start_time: START, end_time: START + 120000 });
const players = { 7: { name: "Aldra", type: "Mage" }, 9: { name: "Cyra", type: "Rogue" } };
const cast = (source, at, guid = 100) => ({ type: "cast", timestamp: START + at, sourceID: source, ability: { guid } });
const begin = (source, at, guid = 100) => ({ type: "begincast", timestamp: START + at, sourceID: source, ability: { guid } });
const swing = (source, at) => ({ type: "damage", timestamp: START + at, sourceID: source, ability: { guid: 1 }, amount: 500 });

describe("logcheck/activityTimeline — activityBands", () => {
    it("covers an instant cast with one GCD and merges back-to-back casts into one band", () => {
        expect(GCD_MS).toBe(1500);
        const bands = activityBands([cast(7, 0), cast(7, 1500), cast(7, 3000)], START, 120000);
        expect(bands).toEqual([[0, 4500]]);
    });

    it("covers a hardcast from its begin to its completion", () => {
        const bands = activityBands([begin(7, 0, 5), cast(7, 2500, 5), cast(7, 2500, 6)], START, 120000);
        expect(bands).toEqual([[0, 4000]]);
    });

    it("gives an interrupted hardcast at least a GCD", () => {
        const bands = activityBands([begin(7, 0, 5), begin(7, 800, 5), cast(7, 3300, 5)], START, 120000);
        expect(bands).toEqual([[0, 3300]]);
        expect(activityBands([begin(7, 10000, 5)], START, 120000)).toEqual([[10000, 11500]]);
    });

    it("counts white swings and auto shots, ignores other damage and events after judging ended", () => {
        const bands = activityBands([swing(9, 0), { ...swing(9, 500), ability: { guid: 9999 } }, { ...swing(9, 1000), ability: { guid: 75 } }, swing(9, 90000)], START, 60000);
        expect(bands).toEqual([[0, 2500]]);
    });
});

describe("logcheck/activityTimeline — findGaps", () => {
    it("reports the holes from the pull to the end, ignoring short ones, and names the mechanic where one landed", () => {
        expect(MIN_GAP_MS).toBe(3000);
        const gaps = findGaps([[2000, 20000], [22000, 40000], [50000, 60000]], 100000, [{ at: 45000, kind: "debuff" }]);
        expect(gaps).toEqual([
            { from: 40000, to: 50000, reason: "mechanic" },
            { from: 60000, to: 100000, reason: "unknown" },
        ]);
    });

    it("has no holes when the bands cover the judged time", () => {
        expect(findGaps([[0, 100000]], 100000, [])).toEqual([]);
    });
});

describe("logcheck/activityTimeline — rows for one fight", () => {
    const casts = [];
    for (let t = 1000; t < 120000; t += 1500) casts.push(cast(7, t));           // Aldra never stops
    for (let t = 0; t < 60000; t += 1400) casts.push(swing(9, t));               // Cyra swings for a minute, then dies

    it("lays every player's activity on the timeline with holes, judged until their death", () => {
        const rows = activityForFight(casts.filter((e) => e.type === "cast"), casts.filter((e) => e.type === "damage"), fight, players, [{ at: 60000, name: "Cyra" }]);
        expect(rows.map((r) => r.name)).toEqual(["Cyra", "Aldra"]);   // most active first
        const cyra = rows[0];
        expect(cyra.judgedUntil).toBe(60000);
        expect(cyra.diedAt).toBe(60000);
        expect(cyra.activePct).toBe(100);
        expect(cyra.gaps).toEqual([]);
        expect(cyra.swings).toBe(43);
        const aldra = rows[1];
        expect(aldra.activePct).toBe(99);
        expect(aldra.casts).toBe(80);
        expect(aldra.gaps).toEqual([]);        // the one-second pull delay is under the floor
        expect(aldra.diedAt).toBeNull();
    });

    it("labels a hole with the avoidable debuff that sat on the player and sums the unexplained rest", () => {
        const events = [cast(7, 0), cast(7, 1500), cast(7, 20000), cast(7, 21500), cast(7, 60000)];
        const mechanics = { players: [{ name: "Aldra", hits: [{ at: 4000, kind: "debuff" }, { at: 30000, kind: "damage" }] }] };
        const [aldra] = activityForFight(events, [], fight, players, [], mechanics);
        expect(aldra.gaps).toEqual([
            { from: 3000, to: 20000, reason: "mechanic" },
            { from: 23000, to: 60000, reason: "unknown" },
            { from: 61500, to: 120000, reason: "unknown" },
        ]);
        expect(aldra.mechanicMs).toBe(17000);
        expect(aldra.unexplainedMs).toBe(37000 + 58500);
        expect(aldra.longestGap).toBe(58500);
        expect(aldra.activePct).toBe(6);
    });

    it("ignores actors that are not raiders and is empty without events", () => {
        expect(activityForFight([cast(42, 0)], [], fight, players)).toEqual([]);
        expect(activityForFight([], [], fight, players)).toEqual([]);
    });
});

describe("logcheck/activityTimeline — summarize", () => {
    it("averages the activity and totals the holes per player", () => {
        const rows = summarize([
            { activity: [{ name: "Aldra", type: "Mage", activePct: 90, gaps: [{ from: 0, to: 5000, reason: "unknown" }], unexplainedMs: 5000, mechanicMs: 0, longestGap: 5000 }] },
            { activity: [{ name: "Aldra", type: "Mage", activePct: 70, gaps: [{ from: 0, to: 4000, reason: "mechanic" }, { from: 10000, to: 20000, reason: "unknown" }], unexplainedMs: 10000, mechanicMs: 4000, longestGap: 10000 }] },
            { activity: null },
        ]);
        expect(rows).toEqual([{ name: "Aldra", type: "Mage", fights: 2, activeAvg: 80, gaps: 3, gapMs: 19000, unexplainedMs: 15000, mechanicMs: 4000, longestGap: 10000 }]);
    });
});

describe("logcheck/activityTimeline — analyzeActivityTimeline", () => {
    const fights = { fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 }, fight] };

    it("pulls casts and swings per boss fight, uses the fight's deaths and mechanics, and returns the summary", async () => {
        const wcl = { getAllEvents: jest.fn(async (_r, view) => (view === "casts" ? [cast(7, 0)] : [swing(9, 0)])) };
        const timeline = { fights: [{ id: 3, deaths: [{ at: 30000, name: "Aldra" }], mechanics: { players: [] }, activity: null }] };
        const result = await analyzeActivityTimeline(wcl, "abc", fights, players, timeline);

        expect(wcl.getAllEvents).toHaveBeenCalledTimes(2);
        expect(wcl.getAllEvents.mock.calls[0].slice(0, 4)).toEqual(["abc", "casts", START, START + 120000]);
        expect(wcl.getAllEvents.mock.calls[1][1]).toBe("damage-done");
        expect(wcl.getAllEvents.mock.calls[1][4].filter).toBe("ability.id in (1,75)");
        expect(wcl.getAllEvents.mock.calls[0][5].maxPages).toBe(300);

        const aldra = timeline.fights[0].activity.find((a) => a.name === "Aldra");
        expect(aldra.judgedUntil).toBe(30000);
        expect(result.players.map((p) => p.name).sort()).toEqual(["Aldra", "Cyra"]);
    });

    it("leaves a fight null when a pull fails and goes on", async () => {
        let n = 0;
        const wcl = { getAllEvents: jest.fn(async () => { if (n++ === 0) throw new Error("boom"); return []; }) };
        const two = { fights: [fight, { ...fight, id: 4 }] };
        const timeline = { fights: [{ id: 3, deaths: [], activity: null }, { id: 4, deaths: [], activity: null }] };
        await analyzeActivityTimeline(wcl, "abc", two, players, timeline);
        expect(timeline.fights[0].activity).toBeNull();
        expect(timeline.fights[1].activity).toEqual([]);
    });

    it("is null without a timeline", async () => {
        const wcl = { getAllEvents: jest.fn() };
        expect(await analyzeActivityTimeline(wcl, "abc", fights, players, null)).toBeNull();
        expect(await analyzeActivityTimeline(wcl, "abc", fights, players, { fights: [] })).toBeNull();
        expect(wcl.getAllEvents).not.toHaveBeenCalled();
    });
});
