const {
    analyzeRaidBuffs, buffsForFight, summarize, buffRole, rosterFromSummary, rosterFromBands, statusOf, untrackedBuffs, inferBands, FULL_PCT, PULL_WINDOW_MS, STRIP_WINDOW_MS,
} = require("../../../src/utils/logcheck/raidBuffs");
const { BUFFS, BLESSINGS, buffByGuid, buffByKey, buffFits, expectedBlessings, ROLES } = require("../../../src/config/raidBuffs");

const KINGS = 25898;       // Greater Blessing of Kings
const MIGHT = 27141;       // Greater Blessing of Might rank 3
const WISDOM = 19742;      // Blessing of Wisdom rank 1
const SALVATION = 1038;    // Blessing of Salvation
const FORT = 25389;        // Power Word: Fortitude rank 7
const PRAYER_FORT = 25392; // Prayer of Fortitude rank 3
const MOTW = 26990;        // Mark of the Wild rank 8
const GIFT = 26991;        // Gift of the Wild rank 3
const AI = 27126;          // Arcane Intellect rank 6
const SPIRIT = 32999;      // Prayer of Spirit rank 2
const SHADOW_PROT = 39374; // Prayer of Shadow Protection rank 2
const LIGHT = 27145;       // Greater Blessing of Light rank 2
const SANCTUARY = 27169;   // Greater Blessing of Sanctuary rank 2

const fight = { id: 3, boss: 650, name: "Gruul the Dragonkiller", kill: true, start_time: 300000, end_time: 420000 };
const fights = { end: 500000, fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 }, fight] };

const band = (from, to) => ({ startTime: from, endTime: to });
const FULL = [band(290000, 500000)];

function roster() {
    return [
        { id: 1, name: "Brokk", type: "Warrior", role: "tank" },
        { id: 2, name: "Elun", type: "Priest", role: "healer" },
        { id: 3, name: "Aldra", type: "Mage", role: "caster" },
        { id: 4, name: "Dorn", type: "Shaman", role: "melee" },
        { id: 5, name: "Leaf", type: "Druid", role: "healer" },
        { id: 6, name: "Uther", type: "Paladin", role: "healer" },
    ];
}

/** Absolute bands per player and buff key, the shape analyzeRaidBuffs hands to buffsForFight. */
function bands() {
    return {
        // the tank: Kings, Fortitude runs out at 1:00, Wisdom although he is a warrior
        Brokk: { byKey: { kings: FULL, fortitude: [band(290000, 360000)], motw: FULL, wisdom: FULL } },
        // the priest: no Mark of the Wild although a druid raided
        Elun: { byKey: { kings: FULL, fortitude: FULL, intellect: FULL, spirit: FULL } },
        // the mage: Salvation instead of Kings — a filled slot, not a missing one
        Aldra: { byKey: { salvation: FULL, fortitude: FULL, motw: FULL, intellect: FULL, spirit: FULL } },
        // the shaman: Gift of the Wild that ends one second after his death, no blessing at all
        Dorn: { byKey: { fortitude: FULL, motw: [band(290000, 361000)] } },
        Leaf: { byKey: { kings: FULL, fortitude: FULL, motw: FULL, intellect: FULL, spirit: FULL } },
        Uther: { byKey: { kings: FULL, fortitude: FULL, motw: FULL, intellect: FULL } },
    };
}

const deaths = [{ at: 60000, name: "Dorn", type: "Shaman" }];

describe("config/raidBuffs", () => {
    it("lists every id once, with label, icon, provider, roles and a known expectation on every entry", () => {
        const seen = new Set();
        for (const b of BUFFS) {
            expect(b.key).toBeTruthy();
            expect(b.label).toBeTruthy();
            expect(b.icon).toBeTruthy();
            expect(b.provider).toBeTruthy();
            expect(b.group).toBeTruthy();
            expect(["blessing", "class", "majority", "never"]).toContain(b.expect);
            expect(b.roles.length).toBeGreaterThan(0);
            for (const r of b.roles) expect(ROLES).toContain(r);
            if (b.expect === "blessing") expect(b.priority).toBeGreaterThan(0);
            expect(b.ids.length).toBeGreaterThan(0);
            for (const id of b.ids) {
                expect(seen.has(id)).toBe(false);
                seen.add(id);
            }
        }
    });

    it("names the group version of every buff that has one, and every group rank resolves to that buff", () => {
        const withGroup = BUFFS.filter((b) => b.groupIds);
        expect(withGroup.map((b) => b.key)).toEqual(["kings", "might", "wisdom", "salvation", "sanctuary", "light", "fortitude", "spirit", "shadowProt", "motw", "intellect"]);
        for (const b of withGroup) {
            expect(b.groupLabel).toBeTruthy();
            expect(b.groupIds.length).toBeGreaterThan(0);
            for (const id of b.groupIds) {
                expect(b.ids).toContain(id);
                expect(buffByGuid(id).key).toBe(b.key);
            }
        }
        expect(buffByKey("motw").groupLabel).toBe("Gabe der Wildnis");
        expect(buffByKey("fortitude").groupLabel).toBe("Gebet der Seelenstärke");
        expect(buffByKey("intellect").groupLabel).toBe("Arkane Brillanz");
        expect(buffByGuid(25392).key).toBe("fortitude");   // Prayer of Fortitude rank 3
        expect(buffByGuid(32999).key).toBe("spirit");      // Prayer of Spirit rank 2
        expect(buffByGuid(39374).key).toBe("shadowProt");  // Prayer of Shadow Protection rank 2
        expect(buffByGuid(27127).key).toBe("intellect");   // Arcane Brilliance rank 2
        expect(buffByGuid(26991).key).toBe("motw");        // Gift of the Wild rank 3
        expect(buffByGuid(27143).key).toBe("wisdom");      // Greater Blessing of Wisdom rank 3
    });

    it("resolves single and group versions of any rank to the same buff", () => {
        expect(buffByGuid(MOTW).key).toBe("motw");
        expect(buffByGuid(GIFT).key).toBe("motw");
        expect(buffByGuid(String(FORT)).key).toBe("fortitude");
        expect(buffByGuid(PRAYER_FORT).key).toBe("fortitude");
        expect(buffByGuid(KINGS).key).toBe("kings");
        expect(buffByGuid(20217).key).toBe("kings");
        expect(buffByGuid(1)).toBeNull();
        expect(buffByGuid(undefined)).toBeNull();
        expect(buffByKey("might").name).toBe("Blessing of Might");
        expect(buffByKey("nope")).toBeNull();
    });

    it("knows who a buff is for: Might on the warrior, Wisdom on the priest, Wisdom on the hunter too", () => {
        expect(buffFits(buffByKey("might"), { type: "Warrior", role: "tank" })).toBe(true);
        expect(buffFits(buffByKey("might"), { type: "Priest", role: "healer" })).toBe(false);
        expect(buffFits(buffByKey("wisdom"), { type: "Warrior", role: "tank" })).toBe(false);
        expect(buffFits(buffByKey("wisdom"), { type: "Priest", role: "healer" })).toBe(true);
        expect(buffFits(buffByKey("wisdom"), { type: "Hunter", role: "melee" })).toBe(true);
        expect(buffFits(buffByKey("kings"), { type: "Rogue", role: "melee" })).toBe(true);
        expect(buffFits(null, { type: "Rogue", role: "melee" })).toBe(false);
    });

    it("expects one blessing per paladin, Kings first, then the role's own", () => {
        const tank = { type: "Warrior", role: "tank" };
        const healer = { type: "Priest", role: "healer" };
        expect(expectedBlessings(tank, 0)).toEqual([]);
        expect(expectedBlessings(tank, 1).map((b) => b.key)).toEqual(["kings"]);
        expect(expectedBlessings(tank, 2).map((b) => b.key)).toEqual(["kings", "might"]);
        expect(expectedBlessings(healer, 3).map((b) => b.key)).toEqual(["kings", "wisdom", "salvation"]);
        expect(expectedBlessings(tank, 9).map((b) => b.key)).toEqual(["kings", "might", "sanctuary", "light"]);
        expect(BLESSINGS[0].key).toBe("kings");
    });

    it("marks Light and Sanctuary as never wrong — TBC raids put them on everyone — and nothing else", () => {
        expect(buffByKey("light").neverWrong).toBe(true);
        expect(buffByKey("sanctuary").neverWrong).toBe(true);
        expect(buffByGuid(LIGHT).key).toBe("light");
        expect(buffByGuid(SANCTUARY).key).toBe("sanctuary");
        for (const b of BUFFS) {
            if (b.key === "light" || b.key === "sanctuary") continue;
            expect({ key: b.key, neverWrong: !!b.neverWrong }).toEqual({ key: b.key, neverWrong: false });
        }
        // they are still only *expected* on the tank
        expect(expectedBlessings({ type: "Mage", role: "caster" }, 9).map((b) => b.key)).toEqual(["kings", "wisdom", "salvation"]);
    });
});

describe("logcheck/raidBuffs — roles", () => {
    it("reads the role from WCL's specs and falls back to the class", () => {
        expect(buffRole("Warrior", [{ role: "tank" }])).toBe("tank");
        expect(buffRole("Warrior", [{ role: "dps", spec: "Fury" }])).toBe("melee");
        expect(buffRole("Druid", [{ role: "dps", spec: "Balance" }])).toBe("caster");
        expect(buffRole("Shaman", [{ role: "dps", spec: "Enhancement" }])).toBe("melee");
        expect(buffRole("Priest", [{ role: "healer" }])).toBe("healer");
        expect(buffRole("Priest", [{ role: "dps", spec: "Shadow" }])).toBe("caster");
        expect(buffRole("Mage", [])).toBe("caster");
        expect(buffRole("Hunter", undefined)).toBe("melee");
    });

    it("builds the fight's roster from the summary, naming players through the report's actor map", () => {
        const idToPlayer = { 1: { name: "Brokk", type: "Warrior" }, 2: { name: "Elun", type: "Priest" } };
        const summary = { composition: [{ id: 1, specs: [{ role: "tank" }] }, { id: 2, specs: [{ role: "healer" }] }, { id: 9, name: "Pet", type: "", specs: [] }, null] };
        expect(rosterFromSummary(summary, idToPlayer)).toEqual([
            { id: 1, name: "Brokk", type: "Warrior", role: "tank" },
            { id: 2, name: "Elun", type: "Priest", role: "healer" },
        ]);
        expect(rosterFromSummary(null, idToPlayer)).toEqual([]);
    });

    it("falls back to whoever carried any aura during the fight", () => {
        const players = [{ id: 1, name: "Brokk", type: "Warrior" }, { id: 2, name: "Elun", type: "Priest" }, { id: 3, name: "Gone", type: "Mage" }];
        const byName = { Brokk: { all: [band(310000, 320000)] }, Elun: { all: [band(0, 1000)] } };
        // by class alone a warrior is a melee — the summary is what knows the tank
        expect(rosterFromBands(players, byName, fight).map((p) => `${p.name}:${p.role}`)).toEqual(["Brokk:melee"]);
    });
});

describe("logcheck/raidBuffs — buffsForFight", () => {
    const result = buffsForFight({ fight, roster: roster(), bandsByName: bands(), deaths });
    const of = (name) => result.players.find((p) => p.name === name);
    const cell = (name, key) => (of(name).buffs.find((b) => b.key === key));

    it("counts the paladins and lists what the roster made expected", () => {
        expect(result.paladins).toBe(1);
        expect(result.expected).toEqual(expect.arrayContaining(["kings", "fortitude", "spirit", "motw", "intellect"]));
        // one paladin: the second blessing is never expected
        expect(result.expected).not.toContain("might");
        expect(result.expected).not.toContain("wisdom");
        // nobody carried Shadow Protection or Thorns, so nobody is asked for it
        expect(result.expected).not.toContain("shadowProt");
        expect(result.expected).not.toContain("thorns");
    });

    it("with one paladin expects one blessing: the tank's missing Might is no finding, the mage's Salvation fills the slot", () => {
        expect(cell("Brokk", "kings")).toEqual(expect.objectContaining({ status: "full", expected: true }));
        expect(cell("Brokk", "might")).toBeUndefined();
        expect(of("Brokk").missing).not.toContain("might");
        expect(cell("Aldra", "salvation")).toEqual(expect.objectContaining({ status: "full", expected: true }));
        expect(cell("Aldra", "kings")).toBeUndefined();
        expect(of("Aldra").missing).toEqual([]);
        // the shaman has no blessing at all: Kings, the first in line, is the missing one
        expect(of("Dorn").missing).toContain("kings");
        expect(cell("Dorn", "kings")).toEqual(expect.objectContaining({ status: "none", expected: true, uptimePct: 0, bands: [] }));
    });

    it("flags a blessing on the wrong role instead of counting it", () => {
        expect(of("Brokk").wrong).toEqual(["wisdom"]);
        expect(cell("Brokk", "wisdom")).toEqual(expect.objectContaining({ status: "full", expected: false, wrong: true }));
    });

    it("counts the group version like the single one and judges a player until their death", () => {
        // Gift of the Wild ends at 1:01, Dorn died at 1:00: full, not partial
        const motw = cell("Dorn", "motw");
        expect(motw).toEqual(expect.objectContaining({ status: "full", expected: true, uptimePct: 100 }));
        expect(motw.bands).toEqual([[0, 60000]]);
        expect(of("Dorn").judgedUntil).toBe(60000);
        expect(of("Dorn").diedAt).toBe(60000);
        expect(of("Brokk").diedAt).toBeNull();
    });

    it("marks a buff that runs out during the fight as partial, not present", () => {
        const fort = cell("Brokk", "fortitude");
        expect(fort.status).toBe("partial");
        expect(fort.uptimePct).toBe(50);
        expect(fort.bands).toEqual([[0, 60000]]);
        expect(of("Brokk").partial).toEqual(["fortitude"]);
        expect(of("Brokk").missing).toEqual([]);
        expect(FULL_PCT).toBeGreaterThan(50);
    });

    it("expects a class buff on everyone it fits as soon as the class raided", () => {
        expect(of("Elun").missing).toContain("motw");
        expect(cell("Elun", "motw")).toEqual(expect.objectContaining({ status: "none", expected: true }));
        // Arcane Intellect is not for the warrior, so its absence is nothing
        expect(cell("Brokk", "intellect")).toBeUndefined();
        expect(cell("Elun", "intellect").expected).toBe(true);
        // ...but the paladin healer runs on mana
        expect(cell("Uther", "intellect").expected).toBe(true);
    });

    it("expects a majority buff only once the raid used it: Divine Spirit on the one healer without it", () => {
        expect(of("Uther").missing).toContain("spirit");
        expect(cell("Uther", "spirit")).toEqual(expect.objectContaining({ status: "none", expected: true }));
        expect(cell("Elun", "spirit")).toEqual(expect.objectContaining({ status: "full", expected: true }));
    });

    it("sums the coverage per buff for the fight", () => {
        const kings = result.coverage.find((c) => c.key === "kings");
        expect(kings).toEqual(expect.objectContaining({ expected: 5, full: 4, none: 1, partial: 0 }));
        const wisdom = result.coverage.find((c) => c.key === "wisdom");
        expect(wisdom).toEqual(expect.objectContaining({ expected: 0, present: 1, wrong: 1 }));
        const fort = result.coverage.find((c) => c.key === "fortitude");
        expect(fort).toEqual(expect.objectContaining({ expected: 6, full: 5, partial: 1 }));
    });

    it("expects nothing from a class that did not raid", () => {
        const noPriestNoPala = roster().filter((p) => p.type !== "Priest" && p.type !== "Paladin");
        const r = buffsForFight({ fight, roster: noPriestNoPala, bandsByName: bands(), deaths: [] });
        expect(r.paladins).toBe(0);
        expect(r.expected).not.toContain("fortitude");
        expect(r.expected).not.toContain("kings");
        for (const p of r.players) expect(p.missing).not.toContain("kings");
        // a Kings that is there is still shown, just not expected
        expect(r.players.find((p) => p.name === "Brokk").buffs.find((b) => b.key === "kings")).toEqual(expect.objectContaining({ status: "full", expected: false }));
    });

    it("with two paladins expects the role's own blessing next to Kings and reports the run-out one", () => {
        const two = [...roster(), { id: 7, name: "Tirion", type: "Paladin", role: "tank" }];
        const b = bands();
        b.Aldra.byKey.kings = [band(290000, 350000)];
        b.Tirion = { byKey: { kings: FULL, might: FULL, fortitude: FULL, motw: FULL, intellect: FULL } };
        const r = buffsForFight({ fight, roster: two, bandsByName: b, deaths: [] });
        expect(r.paladins).toBe(2);
        const aldra = r.players.find((p) => p.name === "Aldra");
        expect(aldra.partial).toEqual(["kings"]);
        expect(aldra.missing).toEqual([]);
        const brokk = r.players.find((p) => p.name === "Brokk");
        expect(brokk.missing).toContain("might");
        const uther = r.players.find((p) => p.name === "Uther");
        expect(uther.missing).toContain("wisdom");
    });

    it("returns null for an empty roster or when everybody died at the pull", () => {
        expect(buffsForFight({ fight, roster: [], bandsByName: {}, deaths: [] })).toBeNull();
        expect(buffsForFight({ fight, roster: roster().slice(0, 1), bandsByName: bands(), deaths: [{ at: 0, name: "Brokk" }] })).toBeNull();
    });

    it("takes the icon the log reported over the table's", () => {
        const r = buffsForFight({ fight, roster: roster(), bandsByName: bands(), deaths: [], icons: { kings: "spell_magic_greaterblessingofkings.jpg" } });
        expect(r.players[0].buffs.find((b) => b.key === "kings").icon).toBe("spell_magic_greaterblessingofkings.jpg");
        expect(r.players[0].buffs.find((b) => b.key === "fortitude").icon).toBe("spell_holy_wordfortitude");
    });

    // A roster player without a buffs table (the request failed, or they were
    // not selected) would otherwise lack every buff — and drive the raid
    // finding on nothing but a missing request.
    it("does not judge a roster player without a buffs table, but still counts their class", () => {
        const b = bands();
        delete b.Uther; // the paladin's table failed
        const r = buffsForFight({ fight, roster: roster(), bandsByName: b, deaths: [] });
        expect(r.players.map((p) => p.name)).not.toContain("Uther");
        expect(r.players).toHaveLength(5);
        // he raided: one paladin, so Kings is still expected on the others...
        expect(r.paladins).toBe(1);
        expect(r.expected).toContain("kings");
        // ...and he himself is nowhere counted as lacking anything: Kings on
        // four players (the shaman without), Intellect on four (he, a mana
        // user, would have been the fifth; the shaman still lacks it)
        const kings = r.coverage.find((c) => c.key === "kings");
        expect(kings).toEqual(expect.objectContaining({ expected: 4, full: 3, none: 1 }));
        const intellect = r.coverage.find((c) => c.key === "intellect");
        expect(intellect).toEqual(expect.objectContaining({ expected: 4, full: 3, none: 1 }));
        expect(buffsForFight({ fight, roster: roster(), bandsByName: bands(), deaths: [] }).coverage.find((c) => c.key === "intellect").expected).toBe(5);
        // nobody with a table at all: nothing to judge
        expect(buffsForFight({ fight, roster: roster(), bandsByName: {}, deaths: [] })).toBeNull();
        expect(buffsForFight({ fight, roster: roster(), bandsByName: undefined, deaths: [] })).toBeNull();
    });

    it("never calls Light or Sanctuary a wrong-role blessing, and lets them fill a blessing slot", () => {
        const two = [...roster(), { id: 7, name: "Tirion", type: "Paladin", role: "tank" }];
        const b = bands();
        // the mage carries Light instead of Wisdom, the shaman (a melee) Sanctuary next to nothing else
        b.Aldra.byKey = { salvation: FULL, light: FULL, fortitude: FULL, motw: FULL, intellect: FULL, spirit: FULL };
        b.Dorn.byKey = { sanctuary: FULL, fortitude: FULL, motw: FULL };
        b.Tirion = { byKey: { kings: FULL, might: FULL, fortitude: FULL, motw: FULL, intellect: FULL } };
        const r = buffsForFight({ fight, roster: two, bandsByName: b, deaths: [] });
        const aldra = r.players.find((p) => p.name === "Aldra");
        expect(aldra.wrong).toEqual([]);
        expect(aldra.missing).toEqual([]);
        // two paladins, two slots: Salvation and Light fill them, Kings is not asked for
        expect(aldra.buffs.find((x) => x.key === "light")).toEqual(expect.objectContaining({ status: "full", expected: true, wrong: false }));
        const dorn = r.players.find((p) => p.name === "Dorn");
        expect(dorn.wrong).toEqual([]);
        expect(dorn.buffs.find((x) => x.key === "sanctuary")).toEqual(expect.objectContaining({ status: "full", expected: true, wrong: false }));
        // one slot filled, the other empty: Kings, the first in line, is the
        // missing one (plus Intellect, as ever for the enhancer on mana)
        expect(dorn.missing).toEqual(["kings", "intellect"]);
        expect(r.coverage.find((c) => c.key === "light").wrong).toBe(0);
        expect(r.coverage.find((c) => c.key === "sanctuary").wrong).toBe(0);
        // Wisdom on the warrior stays wrong
        expect(r.players.find((p) => p.name === "Brokk").wrong).toEqual(["wisdom"]);
    });

    it("tells a buff set after the pull (late) from one that was not there throughout (partial)", () => {
        // 10 s after the pull until the end: late; from the pull to half-way: partial;
        // a hole in the middle: partial too
        expect(statusOf([[10000, 120000]], 120000, 91.7)).toBe("late");
        expect(statusOf([[0, 60000]], 120000, 50)).toBe("partial");
        expect(statusOf([[10000, 60000], [70000, 120000]], 120000, 83.3)).toBe("partial");
        expect(statusOf([[10000, 110000]], 120000, 83.3)).toBe("partial");
        expect(statusOf([[3000, 120000]], 120000, 97.5)).toBe("full");
        expect(statusOf([], 120000, 0)).toBe("none");

        const b = bands();
        b.Leaf.byKey.kings = [band(310000, 500000)]; // Kings only from 0:10 on, then kept
        const r = buffsForFight({ fight, roster: roster(), bandsByName: b, deaths: [] });
        const leaf = r.players.find((p) => p.name === "Leaf");
        expect(leaf.buffs.find((x) => x.key === "kings")).toEqual(expect.objectContaining({ status: "late", expected: true, uptimePct: 92, bands: [[10000, 120000]] }));
        expect(leaf.late).toEqual(["kings"]);
        expect(leaf.partial).toEqual([]);
        expect(leaf.missing).toEqual([]);
        expect(r.coverage.find((c) => c.key === "kings")).toEqual(expect.objectContaining({ expected: 5, full: 3, late: 1, partial: 0, none: 1 }));
        // Brokk's Fortitude still ran out: partial, not late
        expect(r.players.find((p) => p.name === "Brokk").partial).toEqual(["fortitude"]);
        // ...and the summary carries the new counter through
        const sum = summarize([{ id: 3, buffs: r }]);
        expect(sum.players.find((p) => p.name === "Leaf")).toEqual(expect.objectContaining({ late: 1, partial: 0, missing: 0 }));
        expect(sum.players.find((p) => p.name === "Leaf").buffs.kings).toEqual(expect.objectContaining({ expected: 1, late: 1, full: 0, pct: 0 }));
        expect(sum.rows.find((row) => row.key === "kings")).toEqual(expect.objectContaining({ slots: 5, full: 3, late: 1, none: 1, missingPlayers: 2 }));
    });

    it("judges a player until their first death, not their last", () => {
        // Dorn died at 0:30, was resurrected and died again at 1:00 — the order in the list is irrelevant
        const twice = [{ at: 60000, name: "Dorn", type: "Shaman" }, { at: 30000, name: "Dorn", type: "Shaman" }];
        const r = buffsForFight({ fight, roster: roster(), bandsByName: bands(), deaths: twice });
        expect(of("Dorn").judgedUntil).toBe(60000);
        const dorn = r.players.find((p) => p.name === "Dorn");
        expect(dorn.judgedUntil).toBe(30000);
        expect(dorn.diedAt).toBe(30000);
        expect(dorn.buffs.find((x) => x.key === "motw").bands).toEqual([[0, 30000]]);
    });
});

describe("logcheck/raidBuffs — summarize", () => {
    const f1 = { ...fight, id: 3 };
    // a second, one-minute fight still inside every FULL band; Dorn has Kings this time
    const f2 = { ...fight, id: 5, start_time: 430000, end_time: 490000 };
    const b2 = bands();
    b2.Dorn.byKey.kings = [band(420000, 500000)];
    b2.Dorn.byKey.motw = FULL;
    b2.Brokk.byKey.fortitude = [band(420000, 460000)];
    const rows = [
        { id: 3, buffs: buffsForFight({ fight: f1, roster: roster(), bandsByName: bands(), deaths }) },
        { id: 5, buffs: buffsForFight({ fight: f2, roster: roster(), bandsByName: b2, deaths: [] }) },
        { id: 7, buffs: null },
    ];
    const sum = summarize(rows);

    it("gives every player the share of expected fights each buff was fully there", () => {
        expect(sum.fights).toBe(2);
        expect(sum.paladins).toBe(1);
        const dorn = sum.players.find((p) => p.name === "Dorn");
        // the shaman lacks Kings once and, as a mana user, Arcane Intellect twice
        expect(dorn).toEqual(expect.objectContaining({ type: "Shaman", role: "melee", fights: 2, missing: 3 }));
        expect(dorn.buffs.intellect).toEqual(expect.objectContaining({ expected: 2, none: 2, pct: 0 }));
        expect(dorn.buffs.kings).toEqual(expect.objectContaining({ expected: 2, full: 1, none: 1, pct: 50 }));
        const brokk = sum.players.find((p) => p.name === "Brokk");
        expect(brokk.buffs.fortitude).toEqual(expect.objectContaining({ expected: 2, partial: 2, pct: 0 }));
        expect(brokk.buffs.wisdom).toEqual(expect.objectContaining({ expected: 0, wrong: 2, present: 2, pct: 100 }));
        expect(brokk.wrong).toBe(2);
    });

    it("gives every buff its coverage over the raid and how many players fell short", () => {
        const kings = sum.rows.find((r) => r.key === "kings");
        expect(kings).toEqual(expect.objectContaining({ label: "Segen der Könige", provider: "Paladin", expected: true, fights: 2, slots: 10, full: 9, none: 1, coveragePct: 90, missingPlayers: 1, seenPlayers: 5 }));
        const fort = sum.rows.find((r) => r.key === "fortitude");
        expect(fort).toEqual(expect.objectContaining({ slots: 12, full: 10, partial: 2, coveragePct: 83, missingPlayers: 1 }));
        const wisdom = sum.rows.find((r) => r.key === "wisdom");
        expect(wisdom).toEqual(expect.objectContaining({ expected: false, coveragePct: null, wrong: 2, seenPlayers: 1 }));
        expect(sum.rows.find((r) => r.key === "thorns")).toBeUndefined();
    });

    it("keeps the table's order", () => {
        const order = BUFFS.map((b) => b.key);
        const keys = sum.rows.map((r) => r.key);
        expect(keys).toEqual(order.filter((k) => keys.includes(k)));
    });
});

describe("logcheck/raidBuffs — analyzeRaidBuffs", () => {
    const players = roster().map(({ id, name, type }) => ({ id, name, type }));
    const idToPlayer = {};
    for (const p of players) idToPlayer[p.id] = { name: p.name, type: p.type };
    const aura = (guid, list, icon) => ({ guid, name: String(guid), abilityIcon: icon, bands: list });
    const tables = {
        1: { auras: [aura(KINGS, FULL, "spell_magic_greaterblessingofkings.jpg"), aura(MIGHT, FULL), aura(FORT, [band(290000, 360000)]), aura(MOTW, FULL), aura(WISDOM, FULL), aura(28499, FULL)] },
        2: { auras: [aura(KINGS, FULL), aura(PRAYER_FORT, FULL), aura(AI, FULL), aura(SPIRIT, FULL)] },
        3: { auras: [aura(SALVATION, FULL), aura(FORT, FULL), aura(MOTW, FULL), aura(AI, FULL), aura(SPIRIT, FULL)] },
        4: { auras: [aura(FORT, FULL), aura(GIFT, [band(290000, 361000)])] },
        5: { auras: [aura(KINGS, FULL), aura(FORT, FULL), aura(MOTW, FULL), aura(AI, FULL), aura(SPIRIT, FULL)] },
        6: { auras: [aura(KINGS, FULL), aura(FORT, FULL), aura(MOTW, FULL), aura(AI, FULL), aura(SHADOW_PROT, FULL)] },
    };
    const summary = { composition: roster().map((p) => ({ id: p.id, specs: [{ role: p.role === "tank" ? "tank" : p.role === "healer" ? "healer" : "dps", spec: p.type === "Shaman" ? "Enhancement" : "" }] })) };

    function wclMock() {
        return {
            getBuffs: jest.fn(async (reportId, start, end, extra) => tables[extra.sourceid]),
            getSummary: jest.fn(async () => summary),
        };
    }

    it("fetches one buffs table per player and one summary per fight, and fills the timeline", async () => {
        const wcl = wclMock();
        const timeline = { fights: [{ id: 3, deaths, buffs: null }] };
        const sum = await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline);
        expect(wcl.getBuffs).toHaveBeenCalledTimes(6);
        expect(wcl.getBuffs).toHaveBeenCalledWith("abc", 0, 500000, { sourceid: 4 });
        expect(wcl.getSummary).toHaveBeenCalledTimes(1);
        expect(wcl.getSummary).toHaveBeenCalledWith("abc", 300000, 420000);
        const fb = timeline.fights[0].buffs;
        expect(fb.paladins).toBe(1);
        const dorn = fb.players.find((p) => p.name === "Dorn");
        expect(dorn.role).toBe("melee");
        // no blessing and, as an enhancer on mana, no Arcane Intellect either
        expect(dorn.missing).toEqual(["kings", "intellect"]);
        expect(dorn.buffs.find((b) => b.key === "motw")).toEqual(expect.objectContaining({ status: "full", expected: true }));
        const brokk = fb.players.find((p) => p.name === "Brokk");
        expect(brokk.partial).toEqual(["fortitude"]);
        expect(brokk.wrong).toEqual(["wisdom"]);
        expect(brokk.buffs.find((b) => b.key === "kings").icon).toBe("spell_magic_greaterblessingofkings.jpg");
        // the second blessing is shown, but with one paladin it is not the expected one
        expect(brokk.buffs.find((b) => b.key === "might")).toEqual(expect.objectContaining({ status: "full", expected: false, wrong: false }));
        // the shadow protection on one paladin does not make it expected on the raid
        expect(fb.expected).not.toContain("shadowProt");
        expect(sum.rows.find((r) => r.key === "kings")).toEqual(expect.objectContaining({ slots: 5, full: 4, none: 1 }));
    });

    it("treats a player on the group version and a player on the single version alike", async () => {
        // Elun carries every group version, Leaf the single ones of the same buffs: same status, same key.
        const wcl = wclMock();
        const mixed = {
            ...tables,
            2: { auras: [aura(25898, FULL), aura(25392, FULL), aura(27127, FULL), aura(32999, FULL), aura(26991, FULL)] },
            5: { auras: [aura(20217, FULL), aura(25389, FULL), aura(27126, FULL), aura(27841, FULL), aura(26990, FULL)] },
        };
        wcl.getBuffs.mockImplementation(async (reportId, start, end, extra) => mixed[extra.sourceid]);
        const timeline = { fights: [{ id: 3, deaths, buffs: null }] };
        const sum = await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline);
        const fb = timeline.fights[0].buffs;
        for (const name of ["Elun", "Leaf"]) {
            const p = fb.players.find((x) => x.name === name);
            expect(p.missing).toEqual([]);
            for (const key of ["kings", "fortitude", "intellect", "spirit", "motw"]) {
                expect(p.buffs.find((b) => b.key === key)).toEqual(expect.objectContaining({ status: "full", expected: true }));
            }
        }
        expect(sum.rows.find((r) => r.key === "motw").groupLabel).toBe("Gabe der Wildnis");
    });

    // The Anniversary client does not list Fortitude / Mark of the Wild in the
    // combatant info, so WCL shows no band at the pull for anyone — only a
    // re-cast mid-log makes one. Kings and Arcane Intellect are listed.
    const blindTables = {
        1: { auras: [aura(KINGS, FULL), aura(MIGHT, FULL), aura(WISDOM, FULL), aura(FORT, [band(330000, 400000)])] },   // Fortitude re-cast 30 s in, gone at 1:40
        2: { auras: [aura(KINGS, FULL), aura(AI, FULL), aura(SPIRIT, FULL)] },
        3: { auras: [aura(SALVATION, FULL), aura(AI, FULL), aura(SPIRIT, FULL)] },
        4: { auras: [] },
        5: { auras: [aura(KINGS, FULL), aura(AI, FULL), aura(SPIRIT, FULL)] },
        6: { auras: [aura(KINGS, FULL), aura(AI, FULL)] },
    };
    const ev = (timestamp, type, targetID, guid) => ({ timestamp, type, targetID, ability: { guid } });

    it("reads a buff the combatant info leaves out off the raw events: present where a death or refresh saw it, missing where a death stripped everything else, open otherwise", async () => {
        expect(STRIP_WINDOW_MS).toBe(1500);
        const wcl = wclMock();
        wcl.getBuffs.mockImplementation(async (reportId, start, end, extra) => blindTables[extra.sourceid]);
        wcl.getAllEvents = jest.fn(async () => [
            // Dorn dies at 1:00 with Prayer of Fortitude and Gift of the Wild on him (Kings as the witness)
            ev(360000, "removebuff", 4, KINGS), ev(360000, "removebuff", 4, PRAYER_FORT), ev(360000, "removebuff", 4, GIFT),
            // Aldra dies at 1:30: Kings and the Gift go, no Fortitude — it was not on her
            ev(390000, "removebuff", 3, KINGS), ev(390000, "removebuff", 3, GIFT),
            // Elun gets the Prayer 30 s into the fight and has her Gift refreshed
            ev(330000, "applybuff", 2, PRAYER_FORT), ev(350000, "refreshbuff", 2, GIFT),
            // Uther loses the Gift on the trash after the boss: he had it all along
            ev(450000, "removebuff", 6, GIFT),
            // somebody the report does not know
            ev(340000, "removebuff", 99, PRAYER_FORT),
        ]);
        const timeline = { fights: [{ id: 3, deaths: [...deaths, { at: 90000, name: "Aldra", type: "Mage" }], buffs: null }] };
        const sum = await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline);
        // one walk over the buff events: the blind keys' ranks, plus every other raid buff's removes as death witnesses
        expect(wcl.getAllEvents).toHaveBeenCalledTimes(1);
        const [rid, view, from, to, extra] = wcl.getAllEvents.mock.calls[0];
        expect([rid, view, from, to]).toEqual(["abc", "buffs", 0, 500000]);
        expect(extra.filter).toMatch(/^\(ability\.id in \([\d,]*\b25392\b[\d,]*\b26991\b[\d,]*\)\) or \(type = 'removebuff' and ability\.id in \([\d,]*\b25898\b[\d,]*\)\)$/);
        expect(extra.filter.split(" or ")[1]).not.toMatch(/\b25392\b/);
        const fb = timeline.fights[0].buffs;
        expect(fb.untracked).toEqual([]);
        expect(fb.inferred).toEqual(["fortitude", "motw"]);
        expect(fb.expected).toEqual(expect.arrayContaining(["fortitude", "motw"]));
        const cell = (name, key) => fb.players.find((p) => p.name === name).buffs.find((b) => b.key === key);
        expect(cell("Dorn", "fortitude")).toEqual(expect.objectContaining({ status: "full", expected: true, inferred: true }));
        expect(cell("Dorn", "motw")).toEqual(expect.objectContaining({ status: "full" }));
        expect(cell("Aldra", "fortitude")).toEqual(expect.objectContaining({ status: "none", expected: true }));
        expect(cell("Aldra", "motw")).toEqual(expect.objectContaining({ status: "full" }));
        expect(cell("Elun", "fortitude")).toEqual(expect.objectContaining({ status: "late", bands: [[30000, 120000]] }));
        expect(cell("Elun", "motw")).toEqual(expect.objectContaining({ status: "full" }));
        expect(cell("Brokk", "fortitude")).toEqual(expect.objectContaining({ status: "partial" }));   // the table's own re-cast band
        expect(cell("Brokk", "motw")).toEqual(expect.objectContaining({ status: "unknown", expected: true, inferred: true, bands: [] }));
        expect(cell("Leaf", "fortitude").status).toBe("unknown");
        expect(cell("Uther", "motw").status).toBe("full");
        expect(cell("Uther", "fortitude").status).toBe("unknown");
        // open cells are no finding, a stripped death is
        expect(fb.players.find((p) => p.name === "Aldra").missing).toContain("fortitude");
        expect(fb.players.find((p) => p.name === "Leaf").missing).toEqual([]);
        expect(fb.coverage.find((c) => c.key === "fortitude")).toEqual(expect.objectContaining({ expected: 4, full: 1, late: 1, partial: 1, none: 1, unknown: 2 }));
        expect(fb.coverage.find((c) => c.key === "motw")).toEqual(expect.objectContaining({ expected: 4, full: 4, none: 0, unknown: 2 }));
        // the summary carries the inferred keys, the open cells and per row what was judged
        expect(sum.untracked).toEqual([]);
        expect(sum.inferred.map((u) => u.key)).toEqual(["fortitude", "motw"]);
        expect(sum.inferred[1]).toMatchObject({ label: "Mal der Wildnis", groupLabel: "Gabe der Wildnis" });
        expect(sum.unknownCells).toBe(4);
        expect(sum.rows.find((r) => r.key === "fortitude")).toEqual(expect.objectContaining({ inferred: true, untracked: false, expected: true, unknown: 2, coveragePct: 25, missingPlayers: 3, seenPlayers: 3 }));
        expect(sum.rows.find((r) => r.key === "motw")).toEqual(expect.objectContaining({ inferred: true, expected: true, unknown: 2, coveragePct: 100, missingPlayers: 0, seenPlayers: 4 }));
        const leaf = sum.players.find((p) => p.name === "Leaf");
        expect(leaf.buffs.fortitude).toEqual(expect.objectContaining({ expected: 0, unknown: 1, present: 0, pct: 0 }));
        expect(leaf.unknown).toBe(2);
        expect(leaf.missing).toBe(0);
    });

    it("leaves a buff nobody ever carried at any pull unjudged when the events cannot be read", async () => {
        expect(PULL_WINDOW_MS).toBe(2000);
        const wcl = wclMock();
        wcl.getAllEvents = jest.fn(async () => { throw new Error("boom"); });
        wcl.getBuffs.mockImplementation(async (reportId, start, end, extra) => blindTables[extra.sourceid]);
        const timeline = { fights: [{ id: 3, deaths, buffs: null }] };
        const sum = await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline);
        const fb = timeline.fights[0].buffs;
        expect(fb.untracked).toEqual(["fortitude", "motw"]);
        expect(fb.inferred).toEqual([]);
        expect(sum.inferred).toEqual([]);
        // a client without the events walk (an older mock, a test double) takes the same path
        const plain = wclMock();
        plain.getBuffs.mockImplementation(async (reportId, start, end, extra) => blindTables[extra.sourceid]);
        const tl2 = { fights: [{ id: 3, deaths, buffs: null }] };
        await analyzeRaidBuffs(plain, "abc", fights, players, idToPlayer, tl2);
        expect(tl2.fights[0].buffs.untracked).toEqual(["fortitude", "motw"]);
        expect(fb.expected).not.toContain("fortitude");
        expect(fb.expected).not.toContain("motw");
        for (const p of fb.players) {
            expect(p.missing).not.toContain("fortitude");
            expect(p.missing).not.toContain("motw");
        }
        // the mid-fight re-cast is still shown on that player, marked as the blind spot
        const brokk = fb.players.find((p) => p.name === "Brokk");
        expect(brokk.buffs.find((b) => b.key === "fortitude")).toEqual(expect.objectContaining({ status: "partial", expected: false, untracked: true }));
        // Arcane Intellect is still judged: it was at the pull, and Dorn (enhancer on mana) lacks it
        expect(fb.players.find((p) => p.name === "Dorn").missing).toContain("intellect");
        expect(sum.untracked.map((u) => u.key)).toEqual(["fortitude", "motw"]);
        expect(sum.untracked[0]).toMatchObject({ label: "Machtwort: Seelenstärke", groupLabel: "Gebet der Seelenstärke" });
        expect(sum.rows.find((r) => r.key === "fortitude")).toEqual(expect.objectContaining({ untracked: true, expected: false }));
        expect(sum.rows.find((r) => r.key === "intellect")).toEqual(expect.objectContaining({ untracked: false, expected: true }));
    });

    it("untrackedBuffs: tracked once half the raid carried it at the typical pull, a blind spot when only a stray re-cast or one wipe did", () => {
        const bossFights = [{ start_time: 300000 }, { start_time: 600000 }];
        const bands = {
            A: { byKey: { fortitude: [band(299500, 400000), band(599500, 700000)], motw: [band(330000, 400000)], intellect: [band(0, 999999)] } },
            B: { byKey: { fortitude: [band(299000, 400000), band(599000, 700000)], intellect: [band(0, 999999)] } },
            C: { byKey: { kings: [band(0, 999999)], intellect: [band(0, 999999)] } },
            D: { byKey: { kings: [band(0, 999999)] } },
        };
        const blind = untrackedBuffs(bands, bossFights);
        expect(blind.has("fortitude")).toBe(false);   // 2 of 4 at both pulls: tracked
        expect(blind.has("motw")).toBe(true);         // only one player, only mid-fight
        expect(blind.has("intellect")).toBe(false);   // 3 of 4 at every pull
        expect(blind.has("kings")).toBe(false);       // blessings are never a blind spot
        // one re-cast landing on a pull does not make the buff trackable for a raid of 25
        const many = {};
        for (let i = 0; i < 25; i++) many[`P${i}`] = { byKey: { kings: [band(0, 999999)] } };
        many.P0.byKey.fortitude = [band(299000, 400000)];
        expect(untrackedBuffs(many, bossFights).has("fortitude")).toBe(true);
        // nor does one wipe among many fights: a death removes every aura, and WCL draws a band
        // from the pull to the death for each — the wipe shows the buff on everyone, the rest on nobody
        const wipe = { start_time: 900000 };
        const sixteen = [...Array(15)].map((_, i) => ({ start_time: 1000000 + i * 100000 }));
        for (let i = 0; i < 25; i++) many[`P${i}`].byKey.fortitude = [band(900000, 950000)];
        expect(untrackedBuffs(many, [wipe, ...sixteen]).has("fortitude")).toBe(true);
        // two fights, one of them the wipe: the lower median is the other one
        expect(untrackedBuffs(many, [wipe, sixteen[0]]).has("fortitude")).toBe(true);
        // …but a buff really on everyone at every pull is tracked
        for (let i = 0; i < 25; i++) many[`P${i}`].byKey.motw = [band(0, 9999999)];
        expect(untrackedBuffs(many, [wipe, ...sixteen]).has("motw")).toBe(false);
        expect(untrackedBuffs(bands, []).size).toBe(0);
        expect(untrackedBuffs({}, bossFights).size).toBe(0);
    });

    describe("inferBands", () => {
        const idToPlayer2 = { 1: { name: "Brokk" }, 2: { name: "Elun" } };
        const keys = ["fortitude"];
        const bandsOf = (events, deaths = [], logEnd = 1000000) => inferBands({ events, keys, idToPlayer: idToPlayer2, deaths, logEnd });

        it("reads a refresh or a remove without an apply as present since the log's start, an apply as present from then on", () => {
            const out = bandsOf([
                ev(500, "refreshbuff", 1, PRAYER_FORT),      // had it before: since 0
                ev(700, "removebuff", 1, PRAYER_FORT),       // expired
                ev(900, "applybuff", 1, PRAYER_FORT),        // re-cast
                ev(300, "removebuff", 2, FORT),              // died with it
                ev(400, "applybuff", 2, FORT), ev(600, "removebuff", 2, FORT),
            ]);
            expect(out.Brokk.byKey.fortitude).toEqual([{ startTime: 0, endTime: 700 }, { startTime: 900, endTime: 1000000 }]);
            expect(out.Elun.byKey.fortitude).toEqual([{ startTime: 0, endTime: 300 }, { startTime: 400, endTime: 600 }]);
            expect(out.Brokk.absentAt).toEqual({ fortitude: [] });
        });

        it("after a remove the buff is open, not absent: the next remove reaches back to it, a later apply says nothing about the gap", () => {
            const out = bandsOf([ev(300, "removebuff", 1, PRAYER_FORT), ev(800, "removebuff", 1, PRAYER_FORT)]);
            expect(out.Brokk.byKey.fortitude).toEqual([{ startTime: 0, endTime: 300 }, { startTime: 300, endTime: 800 }]);
            const gap = bandsOf([ev(300, "removebuff", 1, PRAYER_FORT), ev(800, "applybuff", 1, PRAYER_FORT)]);
            expect(gap.Brokk.byKey.fortitude).toEqual([{ startTime: 0, endTime: 300 }, { startTime: 800, endTime: 1000000 }]);
        });

        it("takes a death that stripped other buffs but not this one as proof it was missing, and anchors the next remove there", () => {
            const deaths2 = [{ name: "Brokk", at: 500 }, { name: "Elun", at: 500 }];
            const out = bandsOf([
                ev(200, "applybuff", 1, PRAYER_FORT),
                ev(501, "removebuff", 1, KINGS),                                    // Brokk's death is witnessed, no Fortitude went
                ev(3000, "removebuff", 1, PRAYER_FORT),                             // re-buffed unseen, died again with it
                ev(500, "removebuff", 2, KINGS), ev(500, "removebuff", 2, PRAYER_FORT), // Elun's death took the Prayer: present until then
            ], deaths2);
            expect(out.Brokk.absentAt).toEqual({ fortitude: [500] });
            // the open band from the apply is closed at the death, the later remove reaches back to the death only
            expect(out.Brokk.byKey.fortitude).toEqual([{ startTime: 200, endTime: 500 }, { startTime: 500, endTime: 3000 }]);
            expect(out.Elun.absentAt).toEqual({ fortitude: [] });
            expect(out.Elun.byKey.fortitude).toEqual([{ startTime: 0, endTime: 500 }]);
        });

        it("ignores a death nothing was removed at — the log did not see it strip anything — and actors the report does not know", () => {
            const out = bandsOf([ev(3000, "removebuff", 1, PRAYER_FORT), ev(100, "removebuff", 7, PRAYER_FORT)], [{ name: "Brokk", at: 500 }]);
            expect(out.Brokk.absentAt).toEqual({ fortitude: [] });
            expect(out.Brokk.byKey.fortitude).toEqual([{ startTime: 0, endTime: 3000 }]);
            expect(Object.keys(out)).toEqual(["Brokk"]);
            // a witnessed death without any event of the key still yields the absent point and no band
            const only = bandsOf([ev(500, "removebuff", 1, KINGS)], [{ name: "Brokk", at: 500 }]);
            expect(only.Brokk).toEqual({ byKey: {}, absentAt: { fortitude: [500] } });
        });

        it("tracks the single and the group rank apart and lets the union cover the whole time", () => {
            const out = bandsOf([
                ev(100, "refreshbuff", 1, PRAYER_FORT),
                ev(300, "applybuff", 1, FORT), ev(600, "removebuff", 1, FORT),   // a Fortitude on top of the Prayer, gone again
                ev(300, "applybuff", 1, FORT),                                    // a doubled apply changes nothing
            ]);
            expect(out.Brokk.byKey.fortitude).toEqual([{ startTime: 300, endTime: 600 }, { startTime: 0, endTime: 1000000 }]);
            expect(inferBands({ events: [], keys, idToPlayer: idToPlayer2, logEnd: 10 })).toEqual({});
        });
    });

    it("survives a failed buffs table and a failed summary", async () => {
        const wcl = wclMock();
        wcl.getBuffs.mockImplementation(async (reportId, start, end, extra) => {
            if (extra.sourceid === 2) throw new Error("boom");
            return tables[extra.sourceid];
        });
        wcl.getSummary.mockRejectedValue(new Error("nope"));
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const timeline = { fights: [{ id: 3, deaths: [], buffs: null }] };
        const sum = await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline);
        spy.mockRestore();
        const fb = timeline.fights[0].buffs;
        // without a summary the roster is whoever carried an aura, minus the failed priest
        expect(fb.players.map((p) => p.name).sort()).toEqual(["Aldra", "Brokk", "Dorn", "Leaf", "Uther"]);
        // ...with roles by class alone: the paladin counts as a healer, the warrior as a melee
        expect(fb.players.find((p) => p.name === "Uther").role).toBe("healer");
        expect(fb.players.find((p) => p.name === "Brokk").role).toBe("melee");
        expect(sum.players.length).toBe(5);
    });

    // With a working summary the roster comes from WCL, so it lists the priest
    // although his buffs table failed — he must not turn into "lacks everything".
    it("leaves a roster player whose buffs table failed out of the judged players", async () => {
        const wcl = wclMock();
        wcl.getBuffs.mockImplementation(async (reportId, start, end, extra) => {
            if (extra.sourceid === 2) throw new Error("boom");
            return tables[extra.sourceid];
        });
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const timeline = { fights: [{ id: 3, deaths, buffs: null }] };
        const sum = await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline);
        spy.mockRestore();
        const fb = timeline.fights[0].buffs;
        expect(fb.players.map((p) => p.name).sort()).toEqual(["Aldra", "Brokk", "Dorn", "Leaf", "Uther"]);
        // the summary still knows the tank and the healer roles
        expect(fb.players.find((p) => p.name === "Brokk").role).toBe("tank");
        // Fortitude is still expected — a priest raided — and nobody with a table lacked it
        expect(fb.expected).toContain("fortitude");
        expect(fb.coverage.find((c) => c.key === "fortitude")).toEqual(expect.objectContaining({ expected: 5, none: 0 }));
        expect(sum.players.map((p) => p.name)).not.toContain("Elun");
        expect(sum.rows.find((r) => r.key === "motw").missingPlayers).toBe(0);
        expect(sum.rows.find((r) => r.key === "intellect").missingPlayers).toBe(1); // Dorn, as before
    });

    it("returns null without a timeline or without any fight it could fill", async () => {
        const wcl = wclMock();
        expect(await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, null)).toBeNull();
        expect(await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, { fights: [] })).toBeNull();
        const timeline = { fights: [{ id: 99, deaths: [], buffs: null }] };
        expect(await analyzeRaidBuffs(wcl, "abc", fights, players, idToPlayer, timeline)).toBeNull();
        expect(timeline.fights[0].buffs).toBeNull();
    });
});

describe("logcheck/raidBuffs — a kill and a wipe (characterisation, #431)", () => {
    // Pinned before buffsForFight was split into phases: the same raid over a
    // clean kill and a wipe in which everybody dies — once at the pull, twice,
    // or behind a broken death entry.
    const kill = { id: 3, start_time: 300000, end_time: 420000, kill: true };
    const wipe = { id: 5, start_time: 440000, end_time: 480000, kill: false };
    function nightBands() {
        return {
            Brokk: { byKey: { kings: FULL, fortitude: FULL, motw: FULL, might: FULL } },
            Elun: { byKey: { kings: FULL, fortitude: FULL, intellect: FULL, spirit: FULL } },
            Aldra: { byKey: { kings: FULL, fortitude: FULL, motw: [band(290000, 330000)], intellect: FULL } },
            Dorn: { byKey: { kings: FULL, fortitude: FULL, motw: FULL } },
            Leaf: { byKey: { kings: FULL, fortitude: FULL, motw: FULL, intellect: FULL } },
            Uther: { byKey: { kings: FULL, fortitude: FULL, motw: FULL, intellect: FULL } },
        };
    }
    const wipeDeaths = [
        null, { at: NaN, name: "Brokk" }, { at: 0, name: "Brokk" }, { at: 12000, name: "Elun" }, { at: 15000, name: "Aldra" },
        { at: 9000, name: "Aldra" }, { at: 20000, name: "Dorn" }, { at: 25000, name: "Leaf" }, { at: 30000, name: "Uther" },
    ];

    it("judges everybody until their first death and leaves out who died at the pull", () => {
        const r = buffsForFight({ fight: wipe, roster: roster(), bandsByName: nightBands(), deaths: wipeDeaths });
        expect(r.players.map((p) => [p.name, p.judgedUntil, p.diedAt, p.missing, p.late, p.partial, p.wrong])).toEqual([
            ["Elun", 12000, 12000, ["motw"], [], [], []],
            ["Aldra", 9000, 9000, ["motw"], [], [], []],
            ["Dorn", 20000, 20000, ["intellect"], [], [], []],
            ["Leaf", 25000, 25000, [], [], [], []],
            ["Uther", 30000, 30000, [], [], [], []],
        ]);
    });

    it("sums the kill and the wipe", () => {
        const a = buffsForFight({ fight: kill, roster: roster(), bandsByName: nightBands(), deaths: [] });
        const b = buffsForFight({ fight: wipe, roster: roster(), bandsByName: nightBands(), deaths: wipeDeaths });
        const s = summarize([{ id: 3, buffs: a }, { id: 5, buffs: b }]);
        expect(s.players.map((p) => [p.name, p.fights, p.missing, p.partial])).toEqual([
            ["Brokk", 1, 0, 0], ["Elun", 2, 2, 0], ["Aldra", 2, 1, 1], ["Dorn", 2, 2, 0], ["Leaf", 2, 0, 0], ["Uther", 2, 0, 0],
        ]);
        expect(s.rows.map((row) => [row.key, row.slots, row.full, row.partial, row.none, row.missingPlayers])).toEqual([
            ["kings", 11, 11, 0, 0, 0], ["might", 0, 0, 0, 0, 0], ["fortitude", 11, 11, 0, 0, 0],
            ["spirit", 0, 0, 0, 0, 0], ["motw", 11, 7, 1, 3, 2], ["intellect", 10, 8, 0, 2, 1],
        ]);
    });
});

describe("logcheck/raidBuffs — thin input (#431)", () => {
    it("takes a missing death list as nobody died and an entry without bands as no buffs", () => {
        const b = bands();
        b.Leaf = {};
        const r = buffsForFight({ fight, roster: roster(), bandsByName: b });
        expect(r.players.map((p) => [p.name, p.judgedUntil, p.diedAt])).toEqual([
            ["Brokk", 120000, null], ["Elun", 120000, null], ["Aldra", 120000, null], ["Dorn", 120000, null], ["Leaf", 120000, null], ["Uther", 120000, null],
        ]);
        expect(r.players.find((p) => p.name === "Leaf").missing).toEqual(["kings", "fortitude", "spirit", "motw", "intellect"]);
    });
});
