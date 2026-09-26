// The party and raid buffs of a rule set: who can bring each buff (providers),
// who profits (beneficiaries), and what a version leaves out.
const { buildBuffs, SPEC_PROVIDERS, TOTEM_BUFFS } = require("../../../src/config/gameVersions/buffs");
const { buildClasses, CLASSES } = require("../../../src/config/gameVersions/classes");
const tbc = require("../../../src/config/gameVersions/tbc");
const classic = require("../../../src/config/gameVersions/classic");
const forever = require("../../../src/config/gameVersions/forever");

const all = buildBuffs(buildClasses());
const find = (list, key) => list.find((b) => b.key === key);

describe("config/gameVersions/buffs", () => {
    it("splits the buffs by reach: auras, shouts, totems in the party, blessings and prayers raid-wide", () => {
        expect(find(all.partyBuffs, "windfury").scope).toBe("party");
        expect(find(all.partyBuffs, "bloodPact").scope).toBe("party");
        expect(find(all.raidBuffs, "kings").scope).toBe("raid");
        expect(find(all.raidBuffs, "fortitude").scope).toBe("raid");
        expect(all.partyBuffs.every((b) => b.scope === "party")).toBe(true);
        expect(all.raidBuffs.every((b) => b.scope === "raid")).toBe(true);
    });

    it("puts the two shouts and every totem element into one slot per provider", () => {
        expect(find(all.partyBuffs, "battleShout").slot).toBe("shout");
        expect(find(all.partyBuffs, "commandingShout").slot).toBe("shout");
        expect(find(all.partyBuffs, "windfury").slot).toBe("air");
        expect(find(all.partyBuffs, "strengthOfEarth").slot).toBe("earth");
        expect(find(all.partyBuffs, "manaSpring").slot).toBe("water");
        expect(find(all.partyBuffs, "trueshot").slot).toBe("");
    });

    it("lets every spec of the class provide a class buff, and only the named specs a talent buff", () => {
        expect(find(all.partyBuffs, "windfury").providers).toEqual(["Shaman-Elemental", "Shaman-Enhancement", "Shaman-Restoration"]);
        expect(find(all.partyBuffs, "trueshot").providers).toEqual(SPEC_PROVIDERS.trueshot);
        expect(find(all.partyBuffs, "vampiricTouch").providers).toEqual(["Priest-Shadow"]);
        expect(find(all.partyBuffs, "totemOfWrath").providers).toEqual(["Shaman-Elemental"]);
    });

    it("gives a buff to the roles it helps, plus the classes named for mana", () => {
        const wf = find(all.partyBuffs, "windfury");
        expect(wf.beneficiaries).toContain("Warrior-Fury");
        expect(wf.beneficiaries).toContain("Rogue-Combat");
        expect(wf.beneficiaries).not.toContain("Mage-Fire");
        const spring = find(all.partyBuffs, "manaSpring");
        expect(spring.beneficiaries).toContain("Mage-Fire");
        // a mana-using melee class profits although it is not a caster
        expect(spring.beneficiaries).toContain("Paladin-Retribution");
        expect(TOTEM_BUFFS.manaSpring.classes).toEqual(["Hunter", "Shaman", "Paladin"]);
    });

    it("leaves out what a version excludes and every buff nobody in it can bring", () => {
        const noShout = buildBuffs(buildClasses(), { exclude: ["commandingShout"] });
        expect(find(noShout.partyBuffs, "commandingShout")).toBeUndefined();
        expect(find(noShout.partyBuffs, "battleShout")).toBeDefined();

        const noShaman = buildBuffs(buildClasses(CLASSES.filter((c) => c.id !== "Shaman")));
        expect(noShaman.partyBuffs.filter((b) => b.slot === "air" || b.slot === "water" || b.slot === "earth")).toEqual([]);
        expect(find(noShaman.raidBuffs, "kings")).toBeDefined();
    });

    it("shapes every entry the same way", () => {
        for (const b of [...all.partyBuffs, ...all.raidBuffs]) {
            expect(Object.keys(b).sort()).toEqual(["beneficiaries", "icon", "key", "label", "providers", "scope", "slot"]);
            expect(b.providers.length).toBeGreaterThan(0);
        }
    });

    describe("the versions built on it", () => {
        it("gives TBC every buff", () => {
            expect(tbc.id).toBe("tbc");
            expect(tbc.partyBuffs.map((b) => b.key)).toEqual(all.partyBuffs.map((b) => b.key));
            expect(tbc.raidBuffs.map((b) => b.key)).toEqual(all.raidBuffs.map((b) => b.key));
        });

        it("drops the TBC-only buffs from Classic", () => {
            expect(classic.EXCLUDED_BUFFS).toEqual(["commandingShout", "wrathOfAir", "totemOfWrath", "vampiricTouch"]);
            const keys = [...classic.partyBuffs, ...classic.raidBuffs].map((b) => b.key);
            for (const key of classic.EXCLUDED_BUFFS) expect(keys).not.toContain(key);
            expect(keys).toContain("battleShout");
        });

        it("keeps Classic's buffs for Forever", () => {
            expect(forever.id).toBe("forever");
            expect(forever.partyBuffs).toBe(classic.partyBuffs);
            expect(forever.raidBuffs).toBe(classic.raidBuffs);
        });
    });
});
