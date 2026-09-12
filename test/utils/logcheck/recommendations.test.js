const { buildRecommendations, applyReview, raidRules } = require("../../../src/utils/logcheck/recommendations");

/** A report with one raider of everything, tuned so every rule has something to say. */
function fullReport() {
    return {
        roster: [{ name: "Farin", type: "Warlock" }, { name: "Dorn", type: "Shaman" }, { name: "Clean", type: "Mage" }],
        players: [
            { name: "Farin", type: "Warlock", issues: [{ itemName: "Hood", label: "keine Verzauberung", severity: "high" }, { itemName: "Ring", label: "leerer Sockel", severity: "medium" }] },
            { name: "Dorn", type: "Shaman", issues: [] },
            { name: "Clean", type: "Mage", issues: [] },
        ],
        consumables: { players: [
            { name: "Farin", type: "Warlock", flask: 40, elixir: 0, buffed: 40, food: 80, weaponOiled: false },
            { name: "Dorn", type: "Shaman", buffed: 100, food: 100, weaponOiled: true },
            { name: "Clean", type: "Mage", buffed: 100, food: 100, weaponOiled: true },
        ] },
        raidDebuffs: { rows: [
            { key: "coe", label: "Fluch der Elemente", expected: true, fights: 4, missing: 1, avgUptime: 60, maxStacks: 0, avgBelowMax: null },
            { key: "sunder", label: "Rüstung zerreißen", expected: true, fights: 4, missing: 0, avgUptime: 95, maxStacks: 5, avgBelowMax: 40 },
            { key: "recklessness", label: "Tollkühnheit", expected: false, fights: 1, missing: 0, avgUptime: 10 },
        ] },
        totems: { players: [{ name: "Dorn", type: "Shaman", role: "melee", fights: 4, wfFights: 4, wfUptimeAvg: 80, twistingFights: 1, downtimeMs: 25000, gapCount: 6, slotDowntimeMs: { earth: 45000, water: 2000 } }] },
        cooldowns: { players: [
            { name: "Farin", type: "Warlock", fights: 4, uses: 3, possible: 8, missed: 5, usedPct: 38, avgFirstAtMs: 22000, stacked: 1, unstacked: 2 },
            { name: "Clean", type: "Mage", fights: 4, uses: 8, possible: 8, missed: 0, usedPct: 100, avgFirstAtMs: 3000, stacked: 4, unstacked: 0 },
        ] },
        activity: { players: [
            { name: "Farin", type: "Warlock", fights: 4, activeAvg: 65, gaps: 7, gapMs: 90000, unexplainedMs: 60000, mechanicMs: 30000, longestGap: 25000 },
            { name: "Dorn", type: "Shaman", fights: 4, activeAvg: 92, gaps: 2, gapMs: 25000, unexplainedMs: 25000, mechanicMs: 0, longestGap: 20000 },
            { name: "Clean", type: "Mage", fights: 4, activeAvg: 97, gaps: 0, gapMs: 0, unexplainedMs: 0, mechanicMs: 0, longestGap: 0 },
            { name: "A", activeAvg: 60 }, { name: "B", activeAvg: 60 },
        ] },
        mechanics: {
            players: [{ name: "Farin", type: "Warlock", hits: 7, amount: 20000, deaths: 2, avoidableDeaths: 1, earlyDeaths: 1, topMechanic: { key: "damage:Whirlwind", label: "Wirbelwind", hits: 5 } }],
            mechanics: [{ key: "damage:Whirlwind", label: "Wirbelwind", hits: 12, fights: 3 }, { key: "x", label: "X", hits: 2, fights: 1 }],
            deaths: { total: 5, avoidable: 3, early: 2, nearEnd: 0, repeat: 0 },
        },
        rpb: { activity: { players: [{ name: "Farin", singleTargetCasts: [{ label: "Schattenblitz", mostlyLowerRank: true, lowerRankPercent: 80 }], aoeCasts: [] }] } },
        shadowResi: { boss: "Mother Shahraz", players: [{ name: "Farin", type: "Warlock", sr: 120 }, { name: "Clean", type: "Mage", sr: 400 }] },
        timeline: { fights: [{ id: 1, cooldowns: { lust: { casts: 3, spreadMs: 15000 } } }, { id: 2, cooldowns: { lust: { casts: 1, spreadMs: 0 } } }] },
    };
}

/** The raid-buff half apart from fullReport(): the raid rules keep at most five, and these would push the others out. */
function buffReport() {
    return {
        ...fullReport(),
        raidBuffs: {
            fights: 4, paladins: 2,
            players: [
                { name: "Farin", type: "Warlock", role: "caster", fights: 4, missing: 2, partial: 1, wrong: 0, buffs: {
                    kings: { expected: 4, full: 2, partial: 0, none: 2, present: 2, wrong: 0, pct: 50 },
                    wisdom: { expected: 4, full: 3, partial: 1, none: 0, present: 4, wrong: 0, pct: 75 },
                    fortitude: { expected: 4, full: 4, partial: 0, none: 0, present: 4, wrong: 0, pct: 100 },
                } },
                { name: "Dorn", type: "Shaman", role: "melee", fights: 4, missing: 0, partial: 0, wrong: 4, buffs: {
                    kings: { expected: 4, full: 4, partial: 0, none: 0, present: 4, wrong: 0, pct: 100 },
                    wisdom: { expected: 0, full: 0, partial: 0, none: 0, present: 4, wrong: 4, pct: 100 },
                } },
            ],
            rows: [
                { key: "kings", label: "Segen der Könige", provider: "Paladin", expected: true, fights: 4, slots: 40, full: 30, partial: 2, none: 8, present: 32, wrong: 0, coveragePct: 75, missingPlayers: 4, seenPlayers: 10 },
                { key: "wisdom", label: "Segen der Weisheit", provider: "Paladin", expected: true, fights: 4, slots: 20, full: 19, partial: 1, none: 0, present: 24, wrong: 4, coveragePct: 95, missingPlayers: 1, seenPlayers: 6 },
                { key: "motw", label: "Mal der Wildnis", provider: "Druid", expected: true, fights: 4, slots: 40, full: 40, partial: 0, none: 0, present: 40, wrong: 0, coveragePct: 100, missingPlayers: 0, seenPlayers: 10 },
            ],
        },
    };
}

describe("logcheck/recommendations — player rules", () => {
    const rec = buildRecommendations(fullReport());
    const farin = rec.players.find((p) => p.name === "Farin");
    const keys = farin.items.map((i) => i.key);

    it("fires every rule the report gives it something for", () => {
        expect(keys).toEqual(expect.arrayContaining([
            "gear", "consumables.buffed", "consumables.food", "consumables.oil", "debuff.coe",
            "cooldowns.missed", "cooldowns.late", "cooldowns.stacking", "activity.low",
            "mechanics.hits", "mechanics.deaths", "mechanics.early", "rpb.downrank", "shadowResi",
        ]));
    });

    it("sorts high impact first and carries evidence and a text on every item", () => {
        const impacts = farin.items.map((i) => i.impact);
        const order = { high: 0, medium: 1, low: 2 };
        for (let i = 1; i < impacts.length; i++) expect(order[impacts[i]]).toBeGreaterThanOrEqual(order[impacts[i - 1]]);
        for (const item of farin.items) {
            expect(item.title).toBeTruthy();
            expect(item.text).toBeTruthy();
            expect(Array.isArray(item.evidence)).toBe(true);
        }
        expect(farin.items.find((i) => i.key === "gear").impact).toBe("high");
        expect(farin.items.find((i) => i.key === "consumables.buffed").impact).toBe("high");
        expect(farin.items.find((i) => i.key === "activity.low").impact).toBe("high");
    });

    it("addresses a debuff to its provider class and knows when the raider was the only one", () => {
        const coe = farin.items.find((i) => i.key === "debuff.coe");
        expect(coe.text).toContain("Du warst der einzige Warlock");
        expect(coe.title).toBe("Fluch der Elemente fehlte in 1 Kampf");
        // the shaman does not get the warlock's curse, nor the unexpected one
        expect(rec.players.find((p) => p.name === "Dorn").items.map((i) => i.key)).not.toContain("debuff.coe");
        expect(keys).not.toContain("debuff.recklessness");
    });

    it("tells the shaman about twisting, Windfury downtime and an empty slot, but not a short one", () => {
        const dorn = rec.players.find((p) => p.name === "Dorn");
        const k = dorn.items.map((i) => i.key);
        expect(k).toEqual(expect.arrayContaining(["totems.twisting", "totems.windfury", "totems.slot.earth", "activity.gaps"]));
        expect(k).not.toContain("totems.slot.water");
        expect(dorn.items.find((i) => i.key === "totems.twisting").title).toBe("Twisting nur in 1 von 4 Kämpfen");
        expect(dorn.items.find((i) => i.key === "totems.slot.earth").title).toBe("Erde-Totem 45 s nicht gestellt");
    });

    it("leaves a clean raider with an empty list rather than an invented finding", () => {
        expect(rec.players.find((p) => p.name === "Clean").items).toEqual([]);
    });

    it("skips every rule whose source is missing from the report", () => {
        const bare = buildRecommendations({ roster: [{ name: "X", type: "Mage" }], players: [] });
        expect(bare.players).toEqual([{ name: "X", type: "Mage", items: [] }]);
        expect(bare.raid).toEqual([]);
    });

    it("keeps going when one rule throws", () => {
        const broken = fullReport();
        broken.cooldowns = { players: [{ name: "Farin", possible: 8, missed: 5, usedPct: 38, avgFirstAtMs: {} }] };
        broken.cooldowns.players[0].avgFirstAtMs = null;
        Object.defineProperty(broken.cooldowns.players[0], "stacked", { get() { throw new Error("boom"); } });
        const rec2 = buildRecommendations(broken);
        expect(rec2.players.find((p) => p.name === "Farin").items.map((i) => i.key)).toContain("gear");
    });
});

describe("logcheck/recommendations — series rules (DPS dips)", () => {
    const withSeries = (players) => ({ ...fullReport(), fightSeries: { players } });
    const item = (rec, name) => rec.players.find((p) => p.name === name).items.find((i) => i.key === "series.dips");

    it("tells a DPS whose output sat below half their mean for a quarter of the time, high impact from 40 % on", () => {
        const rec = buildRecommendations(withSeries([
            { name: "Farin", type: "Warlock", measure: "dps", fights: 4, dipPct: 31, avgDps: 812, avgHps: 0 },
            { name: "Clean", type: "Mage", measure: "dps", fights: 4, dipPct: 45, avgDps: 950, avgHps: 0 },
            { name: "Dorn", type: "Shaman", measure: "dps", fights: 4, dipPct: 12, avgDps: 700, avgHps: 0 },
        ]));
        const farin = item(rec, "Farin");
        expect(farin.impact).toBe("medium");
        expect(farin.title).toBe("DPS in 31 % der Zeit eingebrochen");
        expect(farin.text).toContain("Ø 812 DPS über 4 Kämpfe");
        expect(farin.evidence).toEqual([
            { label: "Zeit unter 50 % des Schnitts", value: "31 %" }, { label: "Ø DPS", value: "812" }, { label: "Kämpfe", value: "4" },
        ]);
        expect(item(rec, "Clean").impact).toBe("high");
        expect(item(rec, "Dorn")).toBeUndefined();
    });

    it("leaves healers alone and needs more than one fight of curve", () => {
        const report = withSeries([
            { name: "Farin", type: "Warlock", measure: "dps", fights: 1, dipPct: 60, avgDps: 500, avgHps: 0 },
            { name: "Dorn", type: "Shaman", measure: "hps", fights: 4, dipPct: 60, avgDps: 50, avgHps: 900 },
            { name: "Clean", type: "Mage", measure: "dps", fights: 4, dipPct: 60, avgDps: 500, avgHps: 0 },
        ]);
        report.healers = { players: [{ name: "Clean" }] };
        const rec = buildRecommendations(report);
        expect(item(rec, "Farin")).toBeUndefined();
        expect(item(rec, "Dorn")).toBeUndefined();
        expect(item(rec, "Clean")).toBeUndefined();
        // an older report without the field: nothing, never a false "alles gut"
        expect(item(buildRecommendations(fullReport()), "Farin")).toBeUndefined();
    });
});

describe("logcheck/recommendations — healer rules", () => {
    function healer(over = {}) {
        return {
            name: "Elun", type: "Priest", fights: 4, healingTotal: 600000, overhealTotal: 400000, overhealPct: 40,
            topOverheal: { name: "Großes Heilen", overhealPct: 55, overhealShare: 70 },
            manaFights: 4, manaMinAvg: 12, manaLowFights: 2, potions: 3, potionPcts: [8, 55, 12], potionMissingFights: 1,
            dispels: 6, avgReactionMs: 4200,
            shields: [{ key: "earthShield", label: "Erdschild", uptimeAvg: 60 }, { key: "renew", label: "Erneuerung", uptimeAvg: 20 }],
            ...over,
        };
    }
    const rep = (h, activeAvg = 70) => ({
        roster: [{ name: "Elun", type: "Priest" }], players: [],
        healers: { players: [h], raid: { dispelsMissed: 3, missedByAbility: [{ ability: "Stille", count: 3 }] } },
        activity: { players: [{ name: "Elun", activeAvg, gaps: 5, gapMs: 50000, unexplainedMs: 40000, mechanicMs: 0, longestGap: 20000 }] },
    });
    const items = (h, a) => buildRecommendations(rep(h, a)).players[0].items;

    it("aims the overheal finding at the spell that wasted the most", () => {
        const over = items(healer()).find((i) => i.key === "healers.overheal");
        expect(over.title).toBe("40 % Overheal");
        expect(over.impact).toBe("medium");
        expect(over.text).toContain("Großes Heilen: 55 % davon Overheal, 70 % des gesamten Overheals");
        expect(items(healer({ overhealPct: 55 })).find((i) => i.key === "healers.overheal").impact).toBe("high");
        expect(items(healer({ overhealPct: 20 })).map((i) => i.key)).not.toContain("healers.overheal");
    });

    it("calls a potion at 8 % late and one at 55 % fine", () => {
        const late = items(healer()).find((i) => i.key === "healers.potionLate");
        expect(late.title).toBe("Manatrank 2× erst bei 10 % Mana");
        expect(late.evidence[0].value).toBe("8 %, 12 %");
        expect(items(healer({ potionPcts: [55, 48] })).map((i) => i.key)).not.toContain("healers.potionLate");
    });

    it("reports empty mana, a missing potion, slow dispels and the tank shield, but not a HoT nobody expects", () => {
        const keys = items(healer()).map((i) => i.key);
        expect(keys).toEqual(expect.arrayContaining(["healers.mana", "healers.potionMissing", "healers.dispels", "healers.shield.earthShield"]));
        expect(keys).not.toContain("healers.shield.renew");
        const all = items(healer());
        expect(all.find((i) => i.key === "healers.mana")).toMatchObject({ impact: "high", title: "In 2 Kämpfen unter 10 % Mana" });
        expect(all.find((i) => i.key === "healers.dispels").title).toBe("Dispels im Schnitt erst nach 4,2 s");
        expect(all.find((i) => i.key === "healers.shield.earthShield").title).toBe("Erdschild nur 60 % auf dem Tank");
        const quiet = items(healer({ manaLowFights: 0, potionMissingFights: 0, avgReactionMs: 1500, shields: [{ key: "earthShield", label: "Erdschild", uptimeAvg: 95 }] })).map((i) => i.key);
        expect(quiet).not.toEqual(expect.arrayContaining(["healers.mana", "healers.potionMissing", "healers.dispels", "healers.shield.earthShield"]));
    });

    it("judges a healer's activity by the healer threshold and never nags about holes", () => {
        expect(items(healer(), 70).map((i) => i.key)).not.toEqual(expect.arrayContaining(["activity.low", "activity.gaps"]));
        const low = items(healer(), 50).find((i) => i.key === "activity.low");
        expect(low).toMatchObject({ impact: "medium", title: "Nur 50 % aktiv" });
        expect(low.text).toContain("HoTs vorlegen");
    });

    it("tells the raid which dispellable debuffs nobody removed", () => {
        const raid = raidRules(rep(healer()));
        const d = raid.find((i) => i.key === "raid.dispels");
        expect(d.title).toBe("3 dispelbare Debuffs nie entfernt");
        expect(d.text).toContain("Am häufigsten Stille (3×)");
        expect(raidRules({ healers: { players: [], raid: { dispelsMissed: 1 } } })).toEqual([]);
    });
});

describe("logcheck/recommendations — raid buff rules", () => {
    const rec = buildRecommendations(buffReport());
    const farin = rec.players.find((p) => p.name === "Farin");

    it("tells the raider which expected buff they lacked in how many fights, high impact from half the fights on", () => {
        const kings = farin.items.find((i) => i.key === "raidBuffs.kings");
        expect(kings.impact).toBe("high");
        expect(kings.title).toBe("Segen der Könige in 2 von 4 Kämpfen gefehlt");
        expect(kings.text).toContain("2× gar nicht da");
        expect(kings.evidence).toEqual([{ label: "Kämpfe ohne", value: "2/4" }, { label: "Ausgelaufen", value: "0" }]);
        // one run-out Wisdom is below the threshold, full Fortitude is nothing
        expect(farin.items.map((i) => i.key)).not.toContain("raidBuffs.wisdom");
        expect(farin.items.map((i) => i.key)).not.toContain("raidBuffs.fortitude");
    });

    it("says when a buff ran out rather than never came", () => {
        const all = buffReport();
        all.raidBuffs.players[0].buffs.wisdom = { expected: 4, full: 1, partial: 3, none: 0, present: 4, wrong: 0, pct: 25 };
        const wisdom = buildRecommendations(all).players.find((p) => p.name === "Farin").items.find((i) => i.key === "raidBuffs.wisdom");
        expect(wisdom.impact).toBe("high");
        expect(wisdom.title).toBe("Segen der Weisheit in 3 von 4 Kämpfen gefehlt");
        expect(wisdom.text).toContain("3× im Kampf ausgelaufen");
        expect(wisdom.text).not.toContain("gar nicht");
    });

    it("gives the shaman nothing for a blessing outside his role — that is the paladins' finding", () => {
        expect(rec.players.find((p) => p.name === "Dorn").items.map((i) => i.key).filter((k) => k.startsWith("raidBuffs"))).toEqual([]);
    });

    it("addresses the raid rule to the providers: a buff short on several players, a blessing on the wrong role", () => {
        const raid = raidRules({ raidBuffs: buffReport().raidBuffs });
        const kings = raid.find((i) => i.key === "raid.buff.kings");
        expect(kings.impact).toBe("medium");
        expect(kings.title).toBe("Segen der Könige fehlte auf 4 Spielern");
        expect(kings.text).toContain("Die Paladine: Segen der Könige vor dem Pull auf alle und nach jedem Wipe erneuern. Abdeckung 75 % über 4 Kämpfe.");
        const wrong = raid.find((i) => i.key === "raid.buffWrong.wisdom");
        expect(wrong.title).toBe("Segen der Weisheit 4× auf der falschen Rolle");
        expect(raid.map((i) => i.key)).not.toContain("raid.buff.wisdom");
        expect(raid.map((i) => i.key)).not.toContain("raid.buff.motw");
    });

    it("names the roles a class buff belongs on and calls a coverage under half high impact", () => {
        const raid = raidRules({ raidBuffs: { rows: [{ key: "intellect", label: "Arkane Intelligenz", provider: "Mage", expected: true, fights: 3, slots: 30, full: 9, none: 21, partial: 0, wrong: 0, coveragePct: 30, missingPlayers: 7 }] } });
        expect(raid[0].impact).toBe("high");
        expect(raid[0].text).toContain("Die Mages: Arkane Intelligenz vor dem Pull auf Heiler, Caster und nach jedem Wipe erneuern.");
    });
});

describe("logcheck/recommendations — raid rules", () => {
    it("names the raid's biggest costs, high impact first, at most five", () => {
        const raid = raidRules(fullReport());
        expect(raid.length).toBeLessThanOrEqual(5);
        expect(raid.map((i) => i.key)).toEqual(expect.arrayContaining(["raid.debuff.coe", "raid.earlyDeaths", "raid.avoidableDeaths"]));
        expect(raid[0].impact).toBe("high");
        const all = fullReport();
        const keys = raidRules({ ...all, mechanics: { ...all.mechanics, deaths: { total: 0, avoidable: 0, early: 0 } } }).map((i) => i.key);
        expect(keys).toEqual(expect.arrayContaining(["raid.stacks.sunder", "raid.mechanic.damage:Whirlwind", "raid.lust", "raid.activity"]));
    });

    it("is empty on an empty report", () => {
        expect(raidRules({})).toEqual([]);
    });
});

describe("logcheck/recommendations — applyReview", () => {
    it("lays approval and rewritten text over the items by player and key, null where undecided", () => {
        const rec = buildRecommendations(fullReport());
        const reviewed = applyReview(rec, {
            raid: { "raid.earlyDeaths": { approved: true } },
            players: { Farin: { gear: { approved: false }, "consumables.buffed": { approved: true, text: "Bitte flasken." } } },
        });
        const farin = reviewed.players.find((p) => p.name === "Farin");
        expect(farin.items.find((i) => i.key === "gear")).toEqual(expect.objectContaining({ approved: false, custom: "" }));
        expect(farin.items.find((i) => i.key === "consumables.buffed")).toEqual(expect.objectContaining({ approved: true, custom: "Bitte flasken." }));
        expect(farin.items.find((i) => i.key === "activity.low").approved).toBeNull();
        expect(reviewed.raid.find((i) => i.key === "raid.earlyDeaths").approved).toBe(true);
        // the source is untouched
        expect(rec.players.find((p) => p.name === "Farin").items.find((i) => i.key === "gear").approved).toBeUndefined();
    });

    it("tolerates no review and no recommendations", () => {
        const rec = buildRecommendations(fullReport());
        expect(applyReview(rec, null).players[0].items.every((i) => i.approved === null)).toBe(true);
        expect(applyReview(null, {})).toBeNull();
    });
});
