// The log check's rule sets per version (#747): TBC wraps today's modules
// unchanged, Forever is a Classic-derived set that is not ready yet.
const rules = require("../../../src/utils/logcheck/rules");
const { CLA_ANALYZERS } = require("../../../src/utils/logcheck/report");
const claData = require("../../../src/config/claData");
const rpbData = require("../../../src/config/rpbData");
const raidBuffs = require("../../../src/config/raidBuffs");
const raidDebuffs = require("../../../src/config/raidDebuffs");
const totems = require("../../../src/config/totems");
const healerSpells = require("../../../src/config/healerSpells");
const { POTION_TYPES } = require("../../../src/utils/logcheck/potions");
const { DRUM_TYPE } = require("../../../src/utils/logcheck/drums");
const { LUST_IDS, LUST_MS } = require("../../../src/utils/logcheck/cooldownTimeline");
const { SR_ENCHANT, SR_GEM } = require("../../../src/utils/logcheck/shadowResi");
const { ZONE_TAGS } = require("../../../src/utils/logcheck/rpb/validate");
const gameVersions = require("../../../src/config/gameVersions");

const NINE = ["Druid", "Hunter", "Mage", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"];
const TBC_ONLY = ["drums", "totems", "shadowResi", "rpb"];

describe("utils/logcheck/rules — the rule sets", () => {
    it("names the CLA analyzers report.js runs, in its order", () => {
        expect(rules.CLA_ANALYZER_KEYS).toEqual(CLA_ANALYZERS.map((a) => a.key));
        expect(rules.ALL_ANALYZERS).toEqual([...rules.CLA_ANALYZER_KEYS, "rpb"]);
    });

    it("has rules for TBC and Forever only", () => {
        expect(rules.logcheckRules("tbc").versionId).toBe("tbc");
        expect(rules.logcheckRules("forever").versionId).toBe("forever");
        expect(rules.logcheckRules("classic")).toBeNull();
        expect(rules.logcheckRules("")).toBeNull();
        expect(rules.logcheckRules("nope")).toBeNull();
        expect(rules.analyzersFor("classic")).toEqual([]);
    });

    it("carries the label of the version's rule set", () => {
        expect(rules.logcheckRules("tbc").label).toBe(gameVersions.rulesFor("tbc").label);
        expect(rules.logcheckRules("forever").label).toBe(gameVersions.rulesFor("forever").label);
    });
});

describe("utils/logcheck/rules — TBC is today's modules, unchanged", () => {
    const tbc = rules.logcheckRules("tbc");

    it("is ready and runs every analyzer", () => {
        expect(tbc.ready).toBe(true);
        expect(tbc.analyzers).toEqual(rules.ALL_ANALYZERS);
        expect(tbc.missing).toEqual([]);
    });

    it("knows the nine classes of its rule set", () => {
        expect([...tbc.classes].sort()).toEqual(NINE);
    });

    it("hands out the very tables the analyzers read", () => {
        expect(tbc.data.consumables).toBe(claData.CONSUMABLES);
        expect(tbc.data.gear).toBe(claData);
        expect(tbc.data.raidBuffs).toBe(raidBuffs);
        expect(tbc.data.raidDebuffs).toBe(raidDebuffs);
        expect(tbc.data.totems).toBe(totems);
        expect(tbc.data.healerSpells).toBe(healerSpells);
        expect(tbc.data.rpb).toBe(rpbData);
        expect(tbc.data.potions).toBe(POTION_TYPES);
        expect(tbc.data.drums).toBe(DRUM_TYPE);
        expect(tbc.data.zoneTags).toBe(ZONE_TAGS);
        expect(tbc.data.bloodlust).toEqual({ ids: [...LUST_IDS], durationMs: LUST_MS });
        expect(tbc.data.shadowResistance).toEqual({ items: claData.SHADOW_RESISTANCE, enchants: SR_ENCHANT, gems: SR_GEM });
        expect(tbc.data.excludedEncounterIds).toEqual([rpbData.EXCLUDED_ENCOUNTER_ID]);
        expect(tbc.data.hasteRatingPerPercent).toBe(rpbData.HASTE_RATING_PER_PERCENT);
    });
});

describe("utils/logcheck/rules — Forever, prepared but not ready", () => {
    const forever = rules.logcheckRules("forever");

    it("is not ready and says what is missing", () => {
        expect(forever.ready).toBe(false);
        expect(forever.missing.length).toBeGreaterThan(0);
    });

    it("leaves out the TBC-only analyzers, each with its reason", () => {
        const list = rules.analyzersFor("forever");
        for (const key of TBC_ONLY) expect(list).not.toContain(key);
        expect(Object.keys(rules.FOREVER_LEFT_OUT).sort()).toEqual([...TBC_ONLY].sort());
        expect(forever.leftOut).toBe(rules.FOREVER_LEFT_OUT);
    });

    it("keeps the analyzers whose logic Classic shares, in run order", () => {
        expect(rules.analyzersFor("forever")).toEqual(rules.ALL_ANALYZERS.filter((k) => !TBC_ONLY.includes(k)));
        expect(rules.analyzersFor("forever")).toEqual(expect.arrayContaining(["sunder", "consumables", "potions", "raidBuffs", "timeline"]));
    });

    it("knows Classic's nine classes and the facts Classic settles, and no TBC table", () => {
        expect([...forever.classes].sort()).toEqual(NINE);
        expect(forever.data.excludedEncounterIds).toEqual([]);
        expect(forever.data.hasteRatingPerPercent).toBeNull();
        expect(forever.data.bloodlust).toBeNull();
        for (const key of ["consumables", "gear", "raidBuffs", "raidDebuffs", "totems", "healerSpells", "rpb", "potions", "drums", "shadowResistance", "zoneTags"]) {
            expect([key, forever.data[key]]).toEqual([key, null]);
        }
    });

    it("hands back a copy of the analyzer list", () => {
        rules.analyzersFor("forever").push("drums");
        expect(rules.analyzersFor("forever")).not.toContain("drums");
    });
});

describe("utils/logcheck/rules — the RPB role", () => {
    const counts = (dps, tank, healer, dpsSpec = "") => ({ dps, tank, healer, dpsSpec });

    it("keeps the RPB's tie-breaks for the nine classes", () => {
        expect(rules.classicRole("Hunter", counts(0, 3, 0))).toBe("Physical");
        expect(rules.classicRole("Warlock", counts(0, 0, 3))).toBe("Caster");
        expect(rules.classicRole("Priest", counts(2, 0, 2))).toBe("Caster");
        expect(rules.classicRole("Priest", counts(1, 0, 2))).toBe("Healer");
        expect(rules.classicRole("Warrior", counts(1, 2, 0))).toBe("Tank");
        expect(rules.classicRole("Paladin", counts(0, 0, 0))).toBe("Healer");
        expect(rules.classicRole("Druid", counts(3, 0, 0, "Balance"))).toBe("Caster");
        expect(rules.classicRole("Druid", counts(3, 0, 0, "Feral"))).toBe("Physical");
        expect(rules.classicRole("Shaman", counts(3, 0, 0, "Elemental"))).toBe("Caster");
        expect(rules.classicRole("Shaman", counts(3, 0, 1, "Enhancement"))).toBe("Physical");
        expect(rules.classicRole("DeathKnight", counts(3, 0, 0))).toBe("");
    });

    it("decides the same for TBC and Forever, and an unknown class is Physical as before", () => {
        for (const v of ["tbc", "forever"]) {
            const set = rules.logcheckRules(v);
            for (const cls of NINE) {
                for (const c of [counts(3, 0, 0, "Balance"), counts(0, 3, 0), counts(0, 0, 3), counts(1, 1, 1, "Elemental")]) {
                    expect(set.roleForClass(cls, c)).toBe(rules.classicRole(cls, c));
                }
            }
            expect(set.roleForClass("DeathKnight", counts(0, 5, 0))).toBe("Physical");
            expect(set.roleForClass("Mage")).toBe("Caster");
        }
    });

    describe("a class only the rule set knows (test rule set)", () => {
        const dk = {
            id: "DeathKnight",
            specs: [
                { id: "Blood", role: "tank", buffRole: "tank" },
                { id: "Frost", role: "melee", buffRole: "melee" },
                { id: "Unholy", role: "melee", buffRole: "melee" },
            ],
        };
        const shadowcaller = { id: "Shadowcaller", specs: [{ id: "Void", role: "ranged", buffRole: "caster" }, { id: "Mend", role: "healer", buffRole: "healer" }] };
        const set = rules.makeRuleSet({
            versionId: "test", classDefs: [...gameVersions.rulesFor("tbc").classes, dk, shadowcaller], analyzers: ["timeline", "rpb"], ready: true,
        });

        it("is placed by its specs: tank by majority, else the damage spec WCL named", () => {
            expect(set.roleForClass("DeathKnight", counts(1, 4, 0))).toBe("Tank");
            expect(set.roleForClass("DeathKnight", counts(4, 1, 0, "Frost"))).toBe("Physical");
            expect(set.roleForClass("Shadowcaller", counts(4, 0, 1, "Void"))).toBe("Caster");
            expect(set.roleForClass("Shadowcaller", counts(1, 0, 4))).toBe("Healer");
        });

        it("still decides the nine classes the RPB's way", () => {
            expect(set.roleForClass("Priest", counts(2, 0, 2))).toBe("Caster");
        });

        it("keeps its analyzers in run order", () => {
            expect(set.analyzers).toEqual(["timeline", "rpb"]);
            expect(set.classes).toContain("DeathKnight");
        });
    });

    it("specRole falls back to the role a class can only have", () => {
        expect(rules.specRole({ specs: [{ id: "Only", role: "healer", buffRole: "healer" }] }, counts(5, 0, 0))).toBe("Healer");
        expect(rules.specRole({ specs: [{ id: "Wall", role: "tank", buffRole: "tank" }] }, counts(5, 0, 0))).toBe("Tank");
        expect(rules.specRole({ specs: [] }, counts(5, 0, 0))).toBe("Physical");
        expect(rules.specRole({}, counts(0, 0, 0))).toBe("Physical");
    });
});
