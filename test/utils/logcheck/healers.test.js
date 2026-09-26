const {
    analyzeHealers, healersForFight, healingOf, manaOf, manaCurve, dispelsForFight, tankOf, shieldsForFight, summarize,
    STEP_MS, LOW_MANA_PCT, EMPTY_MANA_PCT, POTION_WORTH_MS, POTION_WORTH_PCT,
} = require("../../../src/utils/logcheck/healers");
const { fight: gruulFight } = require("../../factories/wcl");

const START = 500000;
const fight = gruulFight({ id: 4, start_time: START, end_time: START + 240000 });
const players = { 1: { name: "Elun", type: "Priest" }, 2: { name: "Gwen", type: "Druid" }, 3: { name: "Brokk", type: "Warrior" }, 4: { name: "Aldra", type: "Mage" }, 5: { name: "Dorn", type: "Shaman" } };

const sample = (actor, at, amount, max = 10000) => ({ type: "cast", timestamp: START + at, sourceID: actor, targetID: 3, classResources: [{ type: 0, amount, max }] });
const gain = (actor, at, guid, amount, extra = {}) => ({ type: "energize", timestamp: START + at, sourceID: actor, targetID: actor, ability: { guid }, resourceChange: amount, resourceChangeType: 0, ...extra });
const aura = (type, at, source, target, guid, extra = {}) => ({ type, timestamp: START + at, sourceID: source, targetID: target, ability: { guid, name: `spell ${guid}`, abilityIcon: `icon_${guid}` }, ...extra });
const dispel = (at, source, target, guid) => ({ type: "dispel", timestamp: START + at, sourceID: source, targetID: target, ability: { guid: 527 }, extraAbility: { guid, name: `spell ${guid}`, abilityIcon: `icon_${guid}` }, isBuff: false });

describe("logcheck/healers â€” healingOf", () => {
    it("sums effective healing and overheal, ranks the spells and keeps absorbs apart", () => {
        const h = healingOf([
            { guid: 25314, name: "Greater Heal", abilityIcon: "gh", total: 60000, overheal: 40000, hitCount: 30 },
            { guid: 25235, name: "Flash Heal", abilityIcon: "fh", total: 95000, overheal: 5000, hitCount: 80 },
            { guid: 25218, name: "Power Word: Shield", abilityIcon: "pws", total: 20000, overheal: 0, hitCount: 10 },
        ]);
        expect(h.total).toBe(155000);
        expect(h.overheal).toBe(45000);
        expect(h.absorbs).toBe(20000);
        expect(h.overhealPct).toBe(23);   // 45k of 200k raw healing
        expect(h.spells.map((s) => s.name)).toEqual(["Greater Heal", "Flash Heal"]);
        expect(h.spells[0]).toMatchObject({ overhealPct: 40, share: 50, casts: 30 });
        expect(h.spells[1]).toMatchObject({ overhealPct: 5, share: 50 });
    });

    it("is all zeros for an empty or missing table", () => {
        expect(healingOf(undefined)).toEqual({ total: 0, overheal: 0, absorbs: 0, overhealPct: 0, spells: [] });
    });
});

describe("logcheck/healers â€” manaOf", () => {
    it("reads a classResources list for the source, or for the target when resourceActor says so", () => {
        expect(manaOf({ sourceID: 1, targetID: 3, classResources: [{ type: 0, amount: 4000, max: 10000 }] }, 1)).toEqual({ amount: 4000, max: 10000 });
        expect(manaOf({ sourceID: 1, targetID: 3, classResources: [{ type: 0, amount: 4000, max: 10000 }] }, 3)).toBeNull();
        expect(manaOf({ sourceID: 2, targetID: 1, resourceActor: 2, classResources: [{ type: 0, amount: 1, max: 10 }] }, 1)).toEqual({ amount: 1, max: 10 });
        expect(manaOf({ sourceID: 1, classResources: [{ type: 3, amount: 100, max: 100 }] }, 1)).toBeNull();   // energy, not mana
    });

    it("reads the older sourceResources / targetResources object shapes", () => {
        expect(manaOf({ sourceID: 1, sourceResources: { mana: 300, maxMana: 1000 } }, 1)).toEqual({ amount: 300, max: 1000 });
        expect(manaOf({ sourceID: 1, sourceResources: { resourceType: 0, resourceAmount: 300, maxResourceAmount: 1000 } }, 1)).toEqual({ amount: 300, max: 1000 });
        expect(manaOf({ sourceID: 2, targetID: 1, targetResources: { classResources: [{ type: 0, amount: 5, max: 10 }] } }, 1)).toEqual({ amount: 5, max: 10 });
        expect(manaOf({ sourceID: 1, sourceResources: { hitPoints: 5 } }, 1)).toBeNull();
        expect(manaOf(null, 1)).toBeNull();
    });
});

describe("logcheck/healers â€” manaCurve", () => {
    it("samples the curve per step, finds the low point, the time below 20 % and whether it ran empty", () => {
        expect(STEP_MS).toBe(5000);
        expect(LOW_MANA_PCT).toBe(20);
        expect(EMPTY_MANA_PCT).toBe(10);
        const events = [sample(1, 0, 10000), sample(1, 10000, 5000), sample(1, 20000, 1500), sample(1, 30000, 800), sample(1, 40000, 6000)];
        const m = manaCurve(events, 1, { start: START, end: START + 50000 });
        expect(m.available).toBe(true);
        expect(m.values).toEqual([100, 100, 50, 50, 15, 15, 8, 8, 60, 60, 60]);
        expect(m.min).toBe(8);
        expect(m.minAt).toBe(30000);
        expect(m.lowMs).toBe(20000);   // 20 s at 15 %, 10 s at 8 %
        expect(m.empty).toBe(true);
    });

    it("marks the regeneration with the mana level before it, folds ticks into one press and ignores unknown gains", () => {
        const events = [
            sample(1, 0, 10000), sample(1, 20000, 800),
            gain(1, 20500, 28499, 3000),                 // Super Mana Potion at 8 %
            gain(1, 21000, 20268, 200),                  // Judgement of Wisdom: passive, ignored
            gain(1, 60000, 39609, 500), gain(1, 63000, 39609, 500), gain(1, 66000, 39609, 500), gain(1, 69000, 39609, 500),   // Mana Tide ticks
            { ...gain(1, 80000, 29166, 2000), sourceID: 2 },   // Innervate from the druid
            sample(1, 90000, 9000),
        ];
        const m = manaCurve(events, 1, { start: START, end: START + 100000 });
        expect(m.regen.map((r) => [r.key, r.at, r.pct, r.kind])).toEqual([
            ["superMana", 20500, 8, "potion"],
            ["manaTide", 60000, 8, "cooldown"],
            ["innervate", 80000, 8, "external"],
        ]);
        expect(m.regen[1].amount).toBe(2000);
    });

    it("reports no curve when the events carry no mana, and stops at the healer's death", () => {
        const none = manaCurve([gain(1, 1000, 28499, 3000)], 1, { start: START, end: START + 50000 });
        expect(none.available).toBe(false);
        expect(none.values).toEqual([]);
        expect(none.regen).toHaveLength(1);
        const dead = manaCurve([sample(1, 0, 10000), sample(1, 30000, 500)], 1, { start: START, end: START + 50000, judgeEnd: 20000 });
        expect(dead.values).toHaveLength(5);
        expect(dead.min).toBe(100);
    });
});

describe("logcheck/healers â€” dispelsForFight", () => {
    const dispellable = new Set(["30225"]);

    it("measures the reaction time from the debuff's application and lists what nobody removed", () => {
        const debuffs = [
            aura("applydebuff", 10000, 99, 4, 30225), aura("removedebuff", 11200, 99, 4, 30225),
            aura("applydebuff", 50000, 99, 3, 30225), aura("removedebuff", 58000, 99, 3, 30225),
            aura("applydebuff", 70000, 99, 4, 30225),
            aura("applydebuff", 71000, 99, 4, 31341),   // never dispelled anywhere: not a missed dispel
        ];
        const dispels = [dispel(11200, 1, 4, 30225)];
        const d = dispelsForFight(dispels, debuffs, fight, players, dispellable);
        expect(d.total).toBe(1);
        expect(d.players).toEqual([{ name: "Elun", type: "Priest", count: 1, avgReactionMs: 1200, list: [expect.objectContaining({ at: 11200, target: "Aldra", reactionMs: 1200 })] }]);
        expect(d.missed).toEqual([
            expect.objectContaining({ at: 50000, target: "Brokk", durationMs: 8000, ability: "spell 30225" }),
            expect.objectContaining({ at: 70000, target: "Aldra", durationMs: 170000 }),   // ran to the fight's end
        ]);
    });

    it("skips purges of enemy buffs and dispels of unknown actors, and has no reaction without an application", () => {
        const d = dispelsForFight([{ ...dispel(5000, 1, 4, 30225), isBuff: true }, dispel(6000, 77, 4, 30225), dispel(7000, 1, 4, 30225)], [], fight, players, dispellable);
        expect(d.total).toBe(1);
        expect(d.players[0].avgReactionMs).toBeNull();
        expect(d.missed).toEqual([]);
    });
});

describe("logcheck/healers â€” tankOf", () => {
    const summary = { composition: [{ id: 3, specs: [{ role: "tank" }] }, { id: 5, specs: [{ role: "tank" }, { role: "dps" }] }, { id: 1, specs: [{ role: "healer" }] }] };

    it("takes the listed tank who took the most damage, and falls back to anyone", () => {
        const dmg = { entries: [{ id: 4, total: 90000 }, { id: 3, total: 50000 }, { id: 5, total: 60000 }] };
        expect(tankOf(summary, dmg, players)).toEqual({ id: 5, name: "Dorn", type: "Shaman", damageTaken: 60000 });
        expect(tankOf({ composition: [] }, dmg, players)).toEqual({ id: 4, name: "Aldra", type: "Mage", damageTaken: 90000 });
        expect(tankOf(summary, null, players)).toEqual({ id: 3, name: "Brokk", type: "Warrior", damageTaken: 0 });
        expect(tankOf({ composition: [] }, { entries: [] }, players)).toBeNull();
    });
});

describe("logcheck/healers â€” shieldsForFight", () => {
    it("lays one row per aura and source on the tank, with stacks for Lifebloom, judged until the tank died", () => {
        const events = [
            aura("applybuff", 2000, 5, 3, 32594), aura("removebuff", 62000, 5, 3, 32594), aura("applybuff", 70000, 5, 3, 32594),
            aura("applybuff", 1000, 2, 3, 33763, { stack: 1 }), aura("applybuffstack", 2500, 2, 3, 33763, { stack: 2 }), aura("applybuffstack", 4000, 2, 3, 33763, { stack: 3 }),
            aura("refreshbuff", 9000, 2, 3, 33763), aura("removebuff", 40000, 2, 3, 33763),
            aura("applybuff", 5000, 1, 4, 25218),   // a shield on the mage: not the tank
        ];
        const tank = { id: 3, name: "Brokk", type: "Warrior" };
        const rows = shieldsForFight(events, tank, fight, players, 100000);
        expect(rows.map((r) => [r.key, r.source])).toEqual([["earthShield", "Dorn"], ["lifebloom", "Gwen"]]);
        const es = rows[0];
        expect(es.bands).toEqual([[2000, 62000], [70000, 100000]]);
        expect(es).toMatchObject({ uptimePct: 90, gapCount: 2, longestGap: 8000, firstAt: 2000, fullStacksPct: null, maxStacks: 0 });
        const lb = rows[1];
        expect(lb.stacks.map((b) => b.stacks)).toEqual([1, 2, 3]);
        expect(lb.bands).toEqual([[1000, 40000]]);
        expect(lb).toMatchObject({ uptimePct: 39, maxStacks: 3, fullStacksPct: 36 });
    });

    it("is empty without a tank", () => {
        expect(shieldsForFight([aura("applybuff", 0, 5, 3, 974)], null, fight, players, 1000)).toEqual([]);
    });
});

describe("logcheck/healers â€” healersForFight and summarize", () => {
    function build(overrides = {}) {
        return healersForFight({
            healers: [{ id: 1, name: "Elun", type: "Priest" }, { id: 2, name: "Gwen", type: "Druid" }],
            healing: {
                Elun: [{ guid: 25314, name: "Greater Heal", total: 60000, overheal: 40000 }, { guid: 25235, name: "Flash Heal", total: 95000, overheal: 5000 }],
                Gwen: [{ guid: 33763, name: "Lifebloom", total: 120000, overheal: 10000 }],
            },
            resources: {
                Elun: [sample(1, 0, 10000), sample(1, 100000, 2000), gain(1, 100500, 28499, 3000), sample(1, 200000, 3000)],
                Gwen: [sample(2, 0, 10000), sample(2, 200000, 2500)],
            },
            dispelEvents: [dispel(11200, 1, 4, 30225)],
            debuffEvents: [aura("applydebuff", 10000, 99, 4, 30225), aura("removedebuff", 11200, 99, 4, 30225), aura("applydebuff", 50000, 99, 3, 30225), aura("removedebuff", 58000, 99, 3, 30225)],
            dispellable: new Set(["30225"]),
            tank: { id: 3, name: "Brokk", type: "Warrior" },
            buffEvents: [aura("applybuff", 2000, 2, 3, 33763, { stack: 3 }), aura("removebuff", 200000, 2, 3, 33763)],
            fight, idToPlayer: players, deaths: [{ at: 220000, name: "Gwen" }],
            ...overrides,
        });
    }

    it("assembles the fight: healing, mana with the late potion, dispels and the tank's rows", () => {
        const h = build();
        expect(h.healers.map((x) => x.name)).toEqual(["Elun", "Gwen"]);
        const elun = h.healers[0];
        expect(elun.healing.overhealPct).toBe(23);
        expect(elun.mana.regen).toEqual([expect.objectContaining({ key: "superMana", pct: 20 })]);
        expect(elun.potions).toBe(1);
        expect(elun.potionMissing).toBe(false);
        expect(elun.dispels).toMatchObject({ count: 1, avgReactionMs: 1200 });
        const gwen = h.healers[1];
        expect(gwen.diedAt).toBe(220000);
        expect(gwen.judgedUntil).toBe(220000);
        expect(gwen.potions).toBe(0);
        expect(gwen.potionMissing).toBe(true);    // 4-minute fight, down to 25 %, no potion
        expect(POTION_WORTH_MS).toBe(150000);
        expect(POTION_WORTH_PCT).toBe(30);
        expect(h.tank).toEqual({ id: 3, name: "Brokk", type: "Warrior", judgedUntil: 240000 });
        expect(h.shields).toEqual([expect.objectContaining({ key: "lifebloom", source: "Gwen", uptimePct: 83 })]);
        expect(h.dispels.total).toBe(1);
        expect(h.dispels.missed).toHaveLength(1);
        expect(h.dispels.others).toEqual([]);
    });

    it("names a non-healer's dispels under others and copes with no tank", () => {
        const h = build({ tank: null, dispelEvents: [dispel(11200, 4, 3, 30225)] });
        expect(h.tank).toBeNull();
        expect(h.shields).toEqual([]);
        expect(h.dispels.others).toEqual([expect.objectContaining({ name: "Aldra", count: 1 })]);
        expect(h.healers[0].dispels.count).toBe(0);
    });

    it("summarizes per healer over the raid: overheal and its top spell, mana lows, potions, dispels, shields", () => {
        const f1 = { healers: build() };
        const f2 = { healers: build({ resources: { Elun: [sample(1, 0, 10000), sample(1, 100000, 500)], Gwen: [] }, dispelEvents: [] }) };
        const s = summarize([f1, f2, { healers: null }]);
        expect(s.players.map((p) => p.name)).toEqual(["Elun", "Gwen"]);   // most healing first
        const elun = s.players[0];
        expect(elun).toMatchObject({ fights: 2, healingTotal: 310000, overhealTotal: 90000, overhealPct: 23, manaFights: 2, manaMinAvg: 13, manaLowFights: 1, potions: 1, potionPcts: [20], potionMissingFights: 1, dispels: 1, avgReactionMs: 1200 });
        expect(elun.topOverheal).toMatchObject({ name: "Greater Heal", overhealPct: 40, overhealShare: 89 });
        const gwen = s.players[1];
        expect(gwen.manaFights).toBe(1);
        expect(gwen.potionMissingFights).toBe(1);
        expect(gwen.shields).toEqual([expect.objectContaining({ key: "lifebloom", fights: 2, uptimeAvg: 83 })]);
        expect(gwen.topOverheal).toMatchObject({ name: "Lifebloom" });
        expect(s.raid).toEqual({ dispelsMissed: 3, missedByAbility: [{ ability: "spell 30225", icon: "icon_30225", count: 3 }], tanks: ["Brokk"] });
    });
});

describe("logcheck/healers â€” analyzeHealers", () => {
    function wcl() {
        return {
            getAllEvents: jest.fn(async (id, view, start, end, extra) => {
                if (view === "dispels") return [dispel(11200, 1, 4, 30225)];
                if (view === "debuffs") return [aura("applydebuff", 10000, 99, 4, 30225), aura("removedebuff", 11200, 99, 4, 30225)];
                if (view === "buffs") return [aura("applybuff", 2000, 2, 3, 33763, { stack: 3 })];
                if (view === "resources") return extra.sourceid === 1 ? [sample(1, 0, 10000), sample(1, 100000, 1000)] : [];
                return [];
            }),
            getSummary: jest.fn(async () => ({ composition: [{ id: 1, specs: [{ role: "healer" }] }, { id: 2, specs: [{ role: "healer" }] }, { id: 3, specs: [{ role: "tank" }] }] })),
            getDamageTaken: jest.fn(async () => ({ entries: [{ id: 3, total: 100 }] })),
            getHealing: jest.fn(async (id, start, end, extra) => ({ entries: extra.sourceid === 1 ? [{ guid: 25314, name: "Greater Heal", total: 100, overheal: 50 }] : [] })),
        };
    }

    it("collects the dispels first, then fills every fight and returns the summary", async () => {
        const w = wcl();
        const timeline = { fights: [{ id: 4, deaths: [] }] };
        const out = await analyzeHealers(w, "abc", { fights: [fight] }, players, timeline);
        expect(out.players.map((p) => p.name)).toEqual(["Elun", "Gwen"]);
        expect(timeline.fights[0].healers.healers[0].dispels.count).toBe(1);
        expect(timeline.fights[0].healers.tank.name).toBe("Brokk");
        expect(timeline.fights[0].healers.shields).toHaveLength(1);
        const views = w.getAllEvents.mock.calls.map((c) => c[1]);
        expect(views).toEqual(["dispels", "buffs", "debuffs", "resources", "resources"]);
        const debuffCall = w.getAllEvents.mock.calls.find((c) => c[1] === "debuffs");
        expect(debuffCall[4].filter).toBe("ability.id in (30225)");
        const buffCall = w.getAllEvents.mock.calls.find((c) => c[1] === "buffs");
        expect(buffCall[4].targetid).toBe(3);
        expect(buffCall[4].filter).toContain("33763");
        expect(w.getHealing).toHaveBeenCalledWith("abc", START, START + 240000, { sourceid: 1 });
    });

    it("gives a fight without healers null and returns null when no fight had one", async () => {
        const w = wcl();
        w.getSummary.mockResolvedValue({ composition: [{ id: 3, specs: [{ role: "tank" }] }] });
        const timeline = { fights: [{ id: 4, deaths: [] }] };
        expect(await analyzeHealers(w, "abc", { fights: [fight] }, players, timeline)).toBeNull();
        expect(timeline.fights[0].healers).toBeNull();
        expect(await analyzeHealers(w, "abc", { fights: [] }, players, null)).toBeNull();
    });

    it("survives a failing call: the fight is skipped or the piece left empty, the rest goes on", async () => {
        const w = wcl();
        w.getSummary.mockRejectedValueOnce(new Error("boom"));
        const timeline = { fights: [{ id: 4, deaths: [] }, { id: 5, deaths: [] }] };
        const fights = { fights: [fight, { ...fight, id: 5 }] };
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const out = await analyzeHealers(w, "abc", fights, players, timeline);
        spy.mockRestore();
        expect(timeline.fights[0].healers).toBeNull();
        expect(timeline.fights[1].healers.healers).toHaveLength(2);
        expect(out.players[0].fights).toBe(1);
    });
});
