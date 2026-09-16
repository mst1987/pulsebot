const gv = require("../../src/config/gameVersions");
const { CONTENTS } = require("../../src/config/tbcContent");
const { analyzeRaidProgress, raidSummary } = require("../../src/utils/logcheck/raidProgress");

const ROLES = ["tank", "healer", "melee", "ranged"];

describe("config/gameVersions", () => {
    it("has the three versions, TBC first and default", () => {
        expect(gv.VERSIONS.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
        expect(gv.DEFAULT_VERSION).toBe("tbc");
        expect(gv.rulesFor("classic").label).toBe("Classic Era");
        expect(gv.rulesFor("wotlk")).toBeNull();
    });

    describe.each(gv.VERSIONS.map((v) => [v.id, v]))("%s", (id, rules) => {
        const specs = rules.classes.flatMap((c) => c.specs);
        const specKeys = new Set(specs.map((s) => s.key));

        it("gives every spec a role, a key and a class colour", () => {
            expect(specs.length).toBeGreaterThan(20);
            for (const s of specs) {
                expect(ROLES).toContain(s.role);
                expect(s.key).toBe(`${s.classId}-${s.id}`);
                expect(gv.roleOfSpec(s.key, id)).toBe(s.role);
            }
            for (const c of rules.classes) expect(c.color).toMatch(/^#[0-9A-F]{6}$/i);
        });

        it("has no duplicate spec keys", () => {
            expect(specKeys.size).toBe(specs.length);
        });

        it("lets every tank spec tank and every healer spec heal", () => {
            for (const s of specs) {
                if (s.role === "tank") expect(s.canTank).toBe(true);
                if (s.role === "healer") expect(s.canHeal).toBe(true);
            }
        });

        it("gives every complete instance a final boss and a composition that fits", () => {
            for (const inst of rules.instances.filter((i) => i.status === "complete")) {
                expect(inst.finalBoss).toBeTruthy();
                expect(inst.bosses).toContain(inst.finalBoss);
                expect(inst.sizes).toContain(inst.defaultSize);
                for (const size of inst.sizes) {
                    const c = gv.compositionFor(inst, size);
                    expect(c.source).toBe("instance");
                    expect(c.tanks).toBeGreaterThan(0);
                    expect(c.healers).toBeGreaterThan(0);
                    expect(c.tanks + c.healers).toBeLessThanOrEqual(size);
                }
            }
        });

        it("marks every instance complete or incomplete", () => {
            for (const inst of rules.instances) expect(["complete", "incomplete"]).toContain(inst.status);
        });

        it("lets buffs refer only to specs that exist", () => {
            for (const b of [...rules.partyBuffs, ...rules.raidBuffs]) {
                expect(b.providers.length).toBeGreaterThan(0);
                for (const key of [...b.providers, ...b.beneficiaries]) expect(specKeys.has(key)).toBe(true);
            }
        });
    });

    it("uses instance ids that are unique across every version", () => {
        const ids = gv.VERSIONS.flatMap((v) => v.instances.map((i) => i.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    describe("TBC", () => {
        it("covers every content of tbcContent with the same ids", () => {
            expect(gv.rulesFor("tbc").instances.map((i) => i.id)).toEqual(CONTENTS.map((c) => c.id));
        });

        it("keeps Karazhan and Zul'Aman at ten players, the rest at 25", () => {
            const size = (id) => gv.instance("tbc", id).defaultSize;
            expect(size("kara")).toBe(10);
            expect(size("za")).toBe(10);
            for (const id of ["gruul", "mag", "ssc", "tk", "hyjal", "bt", "swp"]) expect(size(id)).toBe(25);
        });

        it("counts Karazhan by its encounters and ends it at Prince Malchezaar", () => {
            const kara = gv.instance("tbc", "kara");
            expect(kara.bosses).toHaveLength(11);
            expect(kara.finalBoss).toBe("Prince Malchezaar");
            expect(kara.finalBossNames).toContain("Prinz Malchezaar");
        });

        it("knows TBC-only buffs and who brings them", () => {
            const { raidBuffs, partyBuffs } = gv.rulesFor("tbc");
            const wrath = partyBuffs.find((b) => b.key === "wrathOfAir");
            expect(wrath.providers).toEqual(["Shaman-Elemental", "Shaman-Enhancement", "Shaman-Restoration"]);
            expect(wrath.beneficiaries).toContain("Priest-Shadow");
            expect(wrath.beneficiaries).not.toContain("Warrior-Fury");
            expect(partyBuffs.find((b) => b.key === "totemOfWrath").providers).toEqual(["Shaman-Elemental"]);
            expect(partyBuffs.find((b) => b.key === "trueshot").providers).toEqual(["Hunter-Marksmanship"]);
            // hunters want Might although they are ranged in a setup
            expect(raidBuffs.find((b) => b.key === "might").beneficiaries).toContain("Hunter-BeastMastery");
            expect(raidBuffs.find((b) => b.key === "wisdom").beneficiaries).toContain("Paladin-Retribution");
        });

        it("leaves shields and racial auras out", () => {
            const keys = [...gv.rulesFor("tbc").partyBuffs, ...gv.rulesFor("tbc").raidBuffs].map((b) => b.key);
            expect(keys).not.toContain("earthShield");
            expect(keys).not.toContain("heroicPresence");
        });
    });

    describe("Classic", () => {
        it("has the seven raids of the issue with size, final boss and suggestion", () => {
            const table = {
                ony: [40, "Onyxia", 2, 8],
                mc: [40, "Ragnaros", 3, 10],
                bwl: [40, "Nefarian", 4, 10],
                zg: [20, "Hakkar", 2, 5],
                aq20: [20, "Ossirian the Unscarred", 2, 5],
                aq40: [40, "C'Thun", 5, 11],
                naxx: [40, "Kel'Thuzad", 6, 12],
            };
            const instances = gv.rulesFor("classic").instances;
            expect(instances.map((i) => i.id)).toEqual(Object.keys(table));
            for (const [id, [size, boss, tanks, healers]] of Object.entries(table)) {
                const inst = gv.instance("classic", id);
                expect(inst).toMatchObject({ defaultSize: size, finalBoss: boss, status: "complete" });
                expect(gv.compositionFor(inst, size)).toEqual({ tanks, healers, source: "instance" });
            }
        });

        it("has no Wrath of Air, Totem of Wrath or Commanding Shout", () => {
            const keys = [...gv.rulesFor("classic").partyBuffs, ...gv.rulesFor("classic").raidBuffs].map((b) => b.key);
            expect(keys).not.toContain("wrathOfAir");
            expect(keys).not.toContain("totemOfWrath");
            expect(keys).not.toContain("commandingShout");
            expect(keys).toEqual(expect.arrayContaining(["kings", "fortitude", "motw", "windfury", "manaSpring", "battleShout"]));
        });
    });

    describe("Forever", () => {
        const forever = gv.rulesFor("forever");

        it("shares Classic's classes and buffs", () => {
            expect(forever.classes).toBe(gv.rulesFor("classic").classes);
            expect(forever.partyBuffs).toBe(gv.rulesFor("classic").partyBuffs);
        });

        it("has the three announced raids, all incomplete", () => {
            expect(forever.instances.map((i) => [i.id, i.defaultSize, i.status])).toEqual([
                ["forever-barrow", 10, "incomplete"],
                ["forever-hyjal", 20, "incomplete"],
                ["forever-ony", 40, "incomplete"],
            ]);
        });

        it("keeps its Onyxia and Hyjal apart from Classic's and TBC's", () => {
            expect(gv.instanceById("forever-ony").versionId).toBe("forever");
            expect(gv.instanceById("ony").versionId).toBe("classic");
            expect(gv.instanceById("hyjal").versionId).toBe("tbc");
            expect(gv.instance("classic", "forever-ony")).toBeNull();
        });

        it("suggests the default composition while nothing is announced", () => {
            expect(gv.compositionFor(gv.instanceById("forever-hyjal"), 20)).toEqual({ tanks: 2, healers: 5, source: "default" });
        });
    });

    describe("incomplete instances and the unfinished-raid guard", () => {
        it("have no final boss to wait for", () => {
            for (const v of gv.VERSIONS) {
                for (const inst of v.instances.filter((i) => i.status === "incomplete")) {
                    expect(gv.finalBossesOf(inst.id)).toEqual([]);
                }
            }
        });

        it("never block an evaluation", () => {
            const p = analyzeRaidProgress({
                zoneName: "Barrow Deeps",
                fights: [{ id: 1, boss: 9001, name: "Unknown Barrow Lord", kill: false }],
            });
            expect(p.complete).toBe(true);
            expect(p.raids).toEqual([expect.objectContaining({ contentId: "forever-barrow", done: true })]);
            expect(raidSummary(p)[0]).toMatchObject({ contentId: "forever-barrow", finalKilled: true, label: "Barrow" });
        });
    });

    describe("defaultComposition", () => {
        it("follows the suggestions of the issue", () => {
            expect(gv.defaultComposition(10)).toEqual({ tanks: 2, healers: 3 });
            expect(gv.defaultComposition(20)).toEqual({ tanks: 2, healers: 5 });
            expect(gv.defaultComposition(25)).toEqual({ tanks: 3, healers: 6 });
            expect(gv.defaultComposition(40)).toEqual({ tanks: 4, healers: 10 });
        });

        it("never suggests more than the raid holds", () => {
            for (let n = 0; n <= 40; n++) {
                const c = gv.defaultComposition(n);
                expect(c.tanks + c.healers).toBeLessThanOrEqual(n);
            }
        });
    });

    describe("lookups", () => {
        it("answers role and buffs of a spec", () => {
            expect(gv.roleOfSpec("Druid-Guardian")).toBe("tank");
            expect(gv.roleOfSpec("Hunter-Survival", "classic")).toBe("ranged");
            expect(gv.roleOfSpec("Nope-Nope")).toBe("");
            const shaman = gv.buffsOf("Shaman-Elemental");
            expect(shaman.provides.map((b) => b.key)).toEqual(expect.arrayContaining(["totemOfWrath", "wrathOfAir"]));
            expect(shaman.receives.map((b) => b.key)).toContain("wisdom");
            expect(gv.buffsOf("Shaman-Elemental", "nope")).toEqual({ provides: [], receives: [] });
        });

        it("finds Classic raids by boss and zone, and leaves TBC to tbcContent", () => {
            expect(gv.instanceForBoss("Ossirian der Narbenlose")).toBe("aq20");
            expect(gv.instanceForBoss("Lady Vashj")).toBe("");
            expect(gv.instanceForZone("Molten Core")).toBe("mc");
            expect(gv.instanceForZone("")).toBe("");
        });

        it("serves every version with a suggestion per allowed size", () => {
            const versions = gv.publicVersions();
            const kara = versions[0].instances.find((i) => i.id === "kara");
            expect(kara.suggested).toEqual({ 10: { tanks: 2, healers: 3, source: "instance" } });
            expect(versions[0].roles.map((r) => r.id)).toEqual(ROLES);
            expect(JSON.parse(JSON.stringify(versions))).toEqual(versions);
        });
    });
});
