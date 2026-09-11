const {
    analyzeCooldownTimeline, cooldownRowsForFight, summarize, possibleUses, TRACKED,
} = require("../../../src/utils/logcheck/cooldownTimeline");

/** First tracked id whose entry has this key (the rpbData name or the potion key). */
function idFor(key) {
    for (const [id, def] of TRACKED) if (def.key === key) return Number(id);
    throw new Error(`untracked: ${key}`);
}

const START = 300000;
const fight = { id: 3, boss: 650, name: "Gruul the Dragonkiller", start_time: START, end_time: START + 240000 }; // 4 minutes
const players = { 7: { name: "Aldra", type: "Mage" }, 8: { name: "Dorn", type: "Shaman" }, 9: { name: "Cyra", type: "Rogue" } };
const cast = (source, key, at, icon) => ({ type: "cast", timestamp: START + at, sourceID: source, ability: { guid: idFor(key), name: key, abilityIcon: icon } });

describe("logcheck/cooldownTimeline — tracked table", () => {
    it("knows class cooldowns, trinkets, engineering and potions, each id once", () => {
        expect(TRACKED.get(String(idFor("Icy Veins")))).toEqual(expect.objectContaining({ kind: "class", cooldown: 180 }));
        expect(TRACKED.get("2825")).toEqual(expect.objectContaining({ key: "Bloodlust", kind: "class" }));
        expect(TRACKED.get(String(idFor("destruction")))).toEqual(expect.objectContaining({ kind: "potion", cooldown: 120 }));
        expect([...TRACKED.values()].some((d) => d.kind === "trinket")).toBe(true);
        expect([...TRACKED.values()].some((d) => d.kind === "engineering")).toBe(true);
    });

    it("counts the presses that fit a fight: one at the pull, one per full cooldown after", () => {
        expect(possibleUses(120, 119000)).toBe(1);
        expect(possibleUses(120, 240000)).toBe(2);
        expect(possibleUses(120, 250000)).toBe(3);
        expect(possibleUses(0, 250000)).toBe(0);
        expect(possibleUses(120, 0)).toBe(0);
    });
});

describe("logcheck/cooldownTimeline — rows for one fight", () => {
    const events = [
        cast(8, "Bloodlust", 3000, "spell_nature_bloodlust"),
        cast(7, "Icy Veins", 4000),
        cast(7, "Icy Veins", 190000),
        cast(7, "destruction", 5000),
        cast(9, "Adrenaline Rush", 60000),
        { type: "begincast", timestamp: START + 1000, sourceID: 7, ability: { guid: idFor("Icy Veins") } },
        { type: "cast", timestamp: START + 999999, sourceID: 7, ability: { guid: idFor("Icy Veins") } },
        { type: "cast", timestamp: START + 2000, sourceID: 42, ability: { guid: idFor("Icy Veins") } },
        { type: "cast", timestamp: START + 2000, sourceID: 7, ability: { guid: 1 } },
    ];

    it("puts every press on the timeline per player, with the log's icon, count, possible uses and first press", () => {
        const r = cooldownRowsForFight(events, fight, players);
        expect(r.players.map((p) => p.name)).toEqual(["Aldra", "Cyra", "Dorn"]);
        const aldra = r.players[0];
        const iv = aldra.rows.find((x) => x.key === "Icy Veins");
        expect(iv.markers.map((m) => m.at)).toEqual([4000, 190000]);
        expect(iv.count).toBe(2);
        expect(iv.possibleUses).toBe(2);
        expect(iv.missed).toBe(0);
        expect(iv.firstAt).toBe(4000);
        expect(iv.sub).toBe("2/2 · erster 0:04");
        const pot = aldra.rows.find((x) => x.kind === "potion");
        expect(pot.count).toBe(1);
        expect(pot.possibleUses).toBe(2);
        expect(pot.missed).toBe(1);
        // class cooldowns before potions
        expect(aldra.rows.map((x) => x.kind)).toEqual(["class", "potion"]);
        const lust = r.players[2].rows[0];
        expect(lust.icon).toBe("spell_nature_bloodlust");
    });

    it("opens a Bloodlust window and tells stacked presses from unstacked ones", () => {
        const r = cooldownRowsForFight(events, fight, players);
        expect(r.windows).toEqual([{ label: "Bloodlust", from: 3000, to: 43000 }]);
        expect(r.lust).toEqual({ casts: 1, firstAt: 3000, spreadMs: 0 });
        const iv = r.players[0].rows.find((x) => x.key === "Icy Veins");
        expect(iv.stacked).toBe(1); // 0:04 inside, 3:10 outside
        const bf = r.players[1].rows[0];
        expect(bf.stacked).toBe(0);
    });

    it("merges lusts of several groups into one window and reports their spread", () => {
        const r = cooldownRowsForFight([cast(8, "Bloodlust", 3000), cast(8, "Heroism", 9000)], fight, players);
        expect(r.windows).toEqual([{ label: "Bloodlust", from: 3000, to: 49000 }]);
        expect(r.lust).toEqual({ casts: 2, firstAt: 3000, spreadMs: 6000 });
    });

    it("has no stacking verdict without a lust window", () => {
        const r = cooldownRowsForFight([cast(7, "Icy Veins", 4000)], fight, players);
        expect(r.windows).toEqual([]);
        expect(r.lust).toBeNull();
        expect(r.players[0].rows[0].stacked).toBeNull();
    });

    it("flags a cooldown that was ready again long before the end and never pressed", () => {
        const r = cooldownRowsForFight([cast(7, "Icy Veins", 4000)], fight, players);
        const iv = r.players[0].rows[0];
        expect(iv.leftOnTable).toBe(true);
        expect(iv.missed).toBe(1);
        // pressed again as soon as it was back: nothing left
        const again = cooldownRowsForFight([cast(7, "Icy Veins", 4000), cast(7, "Icy Veins", 184000)], fight, players);
        expect(again.players[0].rows[0].leftOnTable).toBe(false);
    });

    it("judges a dead player only until their death", () => {
        const r = cooldownRowsForFight([cast(7, "Icy Veins", 4000)], fight, players, [{ at: 100000, name: "Aldra" }]);
        const aldra = r.players[0];
        expect(aldra.judgedUntil).toBe(100000);
        expect(aldra.rows[0].possibleUses).toBe(1);
        expect(aldra.rows[0].missed).toBe(0);
        expect(aldra.rows[0].leftOnTable).toBe(false);
    });

    it("leaves engineering without a possible-uses verdict", () => {
        const eng = [...TRACKED.entries()].find(([, d]) => d.kind === "engineering");
        const r = cooldownRowsForFight([{ type: "cast", timestamp: START + 5000, sourceID: 9, ability: { guid: Number(eng[0]) } }], fight, players);
        const row = r.players[0].rows[0];
        expect(row.possibleUses).toBeNull();
        expect(row.missed).toBe(0);
        expect(row.sub).toBe("erster 0:05");
    });

    it("is empty for a fight without tracked presses", () => {
        const r = cooldownRowsForFight([], fight, players);
        expect(r).toEqual({ windows: [], players: [], lust: null });
    });
});

describe("logcheck/cooldownTimeline — summarize", () => {
    it("folds uses, misses, first press and stacking per player across fights", () => {
        const rows = summarize([
            { cooldowns: { players: [{ name: "Aldra", type: "Mage", rows: [
                { kind: "class", count: 2, possibleUses: 2, missed: 0, firstAt: 4000, stacked: 1 },
                { kind: "potion", count: 1, possibleUses: 2, missed: 1, firstAt: 5000, stacked: 1 },
            ] }] } },
            { cooldowns: { players: [{ name: "Aldra", type: "Mage", rows: [
                { kind: "class", count: 1, possibleUses: 2, missed: 1, firstAt: 8000, stacked: null },
                { kind: "engineering", count: 3, possibleUses: null, missed: 0, firstAt: 1000, stacked: null },
            ] }] } },
            { cooldowns: null },
        ]);
        expect(rows).toEqual([{
            name: "Aldra", type: "Mage", fights: 2, uses: 7, possible: 6, missed: 2, usedPct: 67, avgFirstAtMs: 6000, stacked: 1, unstacked: 1,
        }]);
    });
});

describe("logcheck/cooldownTimeline — analyzeCooldownTimeline", () => {
    const fights = { fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 }, fight] };

    it("pulls one filtered cast stream per boss fight, fills the timeline and returns the summary", async () => {
        const wcl = { getAllEvents: jest.fn(async () => [cast(7, "Icy Veins", 4000), cast(8, "Bloodlust", 3000)]) };
        const timeline = { fights: [{ id: 3, deaths: [{ at: 100000, name: "Aldra" }], cooldowns: null }] };
        const result = await analyzeCooldownTimeline(wcl, "abc", fights, players, timeline);

        expect(wcl.getAllEvents).toHaveBeenCalledTimes(1);
        const [id, view, start, end, extra, opts] = wcl.getAllEvents.mock.calls[0];
        expect([id, view, start, end]).toEqual(["abc", "casts", START, START + 240000]);
        expect(extra.filter).toMatch(/^ability\.id in \(\d+(,\d+)+\)$/);
        expect(extra.filter).toContain("2825");
        expect(extra.sourceid).toBeUndefined();
        expect(opts.maxPages).toBe(100);

        const cd = timeline.fights[0].cooldowns;
        expect(cd.windows).toHaveLength(1);
        expect(cd.players.find((p) => p.name === "Aldra").judgedUntil).toBe(100000);
        expect(result.players.map((p) => p.name).sort()).toEqual(["Aldra", "Dorn"]);
    });

    it("leaves a fight null when its pull fails and goes on", async () => {
        let n = 0;
        const wcl = { getAllEvents: jest.fn(async () => { if (n++ === 0) throw new Error("boom"); return []; }) };
        const two = { fights: [fight, { ...fight, id: 4 }] };
        const timeline = { fights: [{ id: 3, deaths: [], cooldowns: null }, { id: 4, deaths: [], cooldowns: null }] };
        await analyzeCooldownTimeline(wcl, "abc", two, players, timeline);
        expect(timeline.fights[0].cooldowns).toBeNull();
        expect(timeline.fights[1].cooldowns).toEqual({ windows: [], players: [], lust: null });
    });

    it("is null without a timeline", async () => {
        const wcl = { getAllEvents: jest.fn() };
        expect(await analyzeCooldownTimeline(wcl, "abc", fights, players, null)).toBeNull();
        expect(await analyzeCooldownTimeline(wcl, "abc", fights, players, { fights: [] })).toBeNull();
        expect(wcl.getAllEvents).not.toHaveBeenCalled();
    });
});
