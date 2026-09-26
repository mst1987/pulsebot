const {
    analyzeMechanics, mechanicsForFight, judgeDeaths, summarize, isAvoidable, TRACKED,
} = require("../../../src/utils/logcheck/mechanics");
const { fight: gruulFight } = require("../../factories/wcl");

/** First tracked id of a mechanic by its rpbData name and kind. */
function idFor(name, kind = "damage") {
    for (const [id, def] of TRACKED) if (def.name === name && def.kind === kind) return Number(id);
    throw new Error(`untracked: ${name}`);
}

const START = 300000;
const fight = gruulFight({ start_time: START, end_time: START + 200000, duration: 200000 });
const players = { 7: { name: "Aldra", type: "Mage" }, 8: { name: "Brokk", type: "Warrior" }, 9: { name: "Cyra", type: "Rogue" } };
const hit = (target, name, at, amount, absorbed = 0) => ({ type: "damage", timestamp: START + at, targetID: target, amount, absorbed, ability: { guid: idFor(name), name, abilityIcon: "icon_from_log" } });
const debuff = (target, name, at, type = "applydebuff") => ({ type, timestamp: START + at, targetID: target, ability: { guid: idFor(name, "debuff"), name } });
const DEBUFF = [...TRACKED.values()].find((d) => d.kind === "debuff").name;

describe("logcheck/mechanics — tracked table", () => {
    it("knows the avoidable damage and the avoidable debuffs, each id once", () => {
        expect(TRACKED.get(String(idFor("Whirlwind")))).toEqual(expect.objectContaining({ kind: "damage", label: "Wirbelwind" }));
        expect([...TRACKED.values()].some((d) => d.kind === "debuff")).toBe(true);
        expect(isAvoidable(idFor("Whirlwind"))).toBe(true);
        expect(isAvoidable(idFor(DEBUFF, "debuff"))).toBe(false);
        expect(isAvoidable(1)).toBe(false);
        expect(isAvoidable(null)).toBe(false);
    });
});

describe("logcheck/mechanics — judgeDeaths", () => {
    it("marks avoidable, early, near-the-end and repeat deaths in place", () => {
        const deaths = [
            { at: 10000, name: "Aldra", abilityId: idFor("Whirlwind") },
            { at: 100000, name: "Brokk", abilityId: 1 },
            { at: 195000, name: "Aldra", abilityId: null },
        ];
        judgeDeaths(deaths, fight);
        expect(deaths[0]).toEqual(expect.objectContaining({ avoidable: true, early: true, nearEnd: false, repeat: false, beforeEnd: 190000 }));
        expect(deaths[1]).toEqual(expect.objectContaining({ avoidable: false, early: false, nearEnd: false, repeat: false }));
        expect(deaths[2]).toEqual(expect.objectContaining({ avoidable: false, early: false, nearEnd: true, repeat: true, beforeEnd: 5000 }));
    });

    it("never calls a death on a wipe near the end", () => {
        const deaths = [{ at: 195000, name: "Aldra" }];
        judgeDeaths(deaths, { ...fight, kill: false });
        expect(deaths[0].nearEnd).toBe(false);
    });

    it("tolerates a fight without deaths", () => {
        expect(judgeDeaths(undefined, fight)).toEqual([]);
    });
});

describe("logcheck/mechanics — rows for one fight", () => {
    const damage = [
        hit(7, "Whirlwind", 5000, 3000),
        hit(7, "Whirlwind", 9000, 2500, 500),
        hit(8, "Whirlwind", 9000, 1000),
        hit(9, "Rain of Fire", 60000, 4000),
        { type: "damage", timestamp: START + 1000, targetID: 7, amount: 5, ability: { guid: 1 } },
        { type: "damage", timestamp: START + 999999, targetID: 7, amount: 5, ability: { guid: idFor("Whirlwind") } },
        { type: "damage", timestamp: START + 1000, targetID: 42, amount: 5, ability: { guid: idFor("Whirlwind") } },
        { type: "damage", timestamp: START + 1000, targetID: 7, amount: 0, absorbed: 0, ability: { guid: idFor("Whirlwind") } },
        { type: "heal", timestamp: START + 1000, targetID: 7, amount: 50, ability: { guid: idFor("Whirlwind") } },
    ];
    const debuffs = [debuff(9, DEBUFF, 30000), debuff(9, DEBUFF, 31000, "refreshdebuff"), debuff(9, DEBUFF, 90000)];

    it("records every avoidable hit per player with time, amount (absorbed included) and the log's icon", () => {
        const r = mechanicsForFight(damage, debuffs, fight, players);
        const aldra = r.players.find((p) => p.name === "Aldra");
        expect(aldra.hits).toEqual([
            { at: 5000, key: "damage:Whirlwind", label: "Wirbelwind", icon: "icon_from_log", kind: "damage", amount: 3000 },
            { at: 9000, key: "damage:Whirlwind", label: "Wirbelwind", icon: "icon_from_log", kind: "damage", amount: 3000 },
        ]);
        expect(aldra.amount).toBe(6000);
        expect(aldra.byMechanic["damage:Whirlwind"]).toEqual(expect.objectContaining({ hits: 2, amount: 6000 }));
        // most damage first
        expect(r.players.map((p) => p.name)).toEqual(["Aldra", "Cyra", "Brokk"]);
    });

    it("counts avoidable debuffs as hits without damage, applies only", () => {
        const r = mechanicsForFight(damage, debuffs, fight, players);
        const cyra = r.players.find((p) => p.name === "Cyra");
        const dbf = cyra.hits.filter((h) => h.kind === "debuff");
        expect(dbf.map((h) => h.at)).toEqual([30000, 90000]);
        expect(dbf[0].amount).toBe(0);
    });

    it("aggregates per mechanic with how many raiders it hit", () => {
        const r = mechanicsForFight(damage, debuffs, fight, players);
        const ww = r.mechanics.find((m) => m.key === "damage:Whirlwind");
        expect(ww).toEqual(expect.objectContaining({ hits: 3, amount: 7000, players: 2, label: "Wirbelwind" }));
        expect(r.mechanics[0].key).toBe("damage:Whirlwind");
    });

    it("is empty without tracked hits", () => {
        expect(mechanicsForFight([], [], fight, players)).toEqual({ players: [], mechanics: [] });
    });
});

describe("logcheck/mechanics — summarize", () => {
    it("folds hits, deaths and the top mechanic per player, mechanics per raid, and the death tally", () => {
        const fights = [
            {
                deaths: [{ name: "Aldra", type: "Mage", avoidable: true, early: true, nearEnd: false, repeat: false }],
                mechanics: {
                    players: [{ name: "Aldra", type: "Mage", hits: [{}, {}], amount: 6000, byMechanic: { "damage:Whirlwind": { label: "Wirbelwind", icon: "i", kind: "damage", hits: 2, amount: 6000 } } }],
                    mechanics: [{ key: "damage:Whirlwind", label: "Wirbelwind", icon: "i", kind: "damage", hits: 2, amount: 6000, players: 1 }],
                },
            },
            {
                deaths: [{ name: "Brokk", type: "Warrior", avoidable: false, early: false, nearEnd: true, repeat: false }],
                mechanics: {
                    players: [{ name: "Aldra", type: "Mage", hits: [{}], amount: 1000, byMechanic: { "damage:Rain of Fire": { label: "Feuerregen", icon: "j", kind: "damage", hits: 1, amount: 1000 } } }],
                    mechanics: [{ key: "damage:Rain of Fire", label: "Feuerregen", icon: "j", kind: "damage", hits: 1, amount: 1000, players: 1 }],
                },
            },
            { deaths: [], mechanics: null },
        ];
        const s = summarize(fights);
        expect(s.deaths).toEqual({ total: 2, avoidable: 1, early: 1, nearEnd: 1, repeat: 0 });
        expect(s.players[0]).toEqual(expect.objectContaining({ name: "Aldra", hits: 3, amount: 7000, deaths: 1, avoidableDeaths: 1, earlyDeaths: 1 }));
        expect(s.players[0].topMechanic).toEqual(expect.objectContaining({ key: "damage:Whirlwind", hits: 2 }));
        expect(s.players.find((p) => p.name === "Brokk")).toEqual(expect.objectContaining({ hits: 0, deaths: 1, topMechanic: null }));
        expect(s.mechanics.map((m) => m.key)).toEqual(["damage:Whirlwind", "damage:Rain of Fire"]);
        expect(s.mechanics[0].fights).toBe(1);
    });
});

describe("logcheck/mechanics — analyzeMechanics", () => {
    const fights = { fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 }, fight] };

    it("judges the deaths, pulls damage and debuff events per fight and returns the summary", async () => {
        const wcl = { getAllEvents: jest.fn(async (_r, view) => (view === "damage-taken" ? [hit(7, "Whirlwind", 5000, 3000)] : [debuff(9, DEBUFF, 30000)])) };
        const timeline = { fights: [{ id: 3, kill: true, duration: 200000, deaths: [{ at: 6000, name: "Aldra", type: "Mage", abilityId: idFor("Whirlwind") }], mechanics: null }] };
        const result = await analyzeMechanics(wcl, "abc", fights, players, timeline);

        expect(wcl.getAllEvents).toHaveBeenCalledTimes(2);
        const [, view, start, end, extra] = wcl.getAllEvents.mock.calls[0];
        expect([view, start, end]).toEqual(["damage-taken", START, START + 200000]);
        expect(extra.filter).toContain(String(idFor("Whirlwind")));
        expect(wcl.getAllEvents.mock.calls[1][1]).toBe("debuffs");
        expect(wcl.getAllEvents.mock.calls[1][4].filter).toContain(String(idFor(DEBUFF, "debuff")));

        expect(timeline.fights[0].deaths[0]).toEqual(expect.objectContaining({ avoidable: true, early: true }));
        expect(timeline.fights[0].mechanics.players.map((p) => p.name).sort()).toEqual(["Aldra", "Cyra"]);
        expect(result.deaths.avoidable).toBe(1);
        expect(result.mechanics).toHaveLength(2);
    });

    it("keeps the judged deaths but leaves mechanics null when a pull fails", async () => {
        const wcl = { getAllEvents: jest.fn(async () => { throw new Error("boom"); }) };
        const timeline = { fights: [{ id: 3, kill: true, duration: 200000, deaths: [{ at: 6000, name: "Aldra" }], mechanics: null }] };
        const result = await analyzeMechanics(wcl, "abc", fights, players, timeline);
        expect(timeline.fights[0].mechanics).toBeNull();
        expect(timeline.fights[0].deaths[0].early).toBe(true);
        expect(result.deaths.total).toBe(1);
    });

    it("is null without a timeline", async () => {
        const wcl = { getAllEvents: jest.fn() };
        expect(await analyzeMechanics(wcl, "abc", fights, players, null)).toBeNull();
        expect(await analyzeMechanics(wcl, "abc", fights, players, { fights: [] })).toBeNull();
        expect(wcl.getAllEvents).not.toHaveBeenCalled();
    });
});
