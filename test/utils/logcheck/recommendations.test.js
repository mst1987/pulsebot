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
