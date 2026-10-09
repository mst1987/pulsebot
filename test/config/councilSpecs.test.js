const {
    ROLES, ROLE_IDS, SPECS, specFor, specByKey, specForRole, rolesForClass, weightsFor, hitStatFor, hitCapFor,
    gearFamilyFor, bisForSpec, aplForSpec, isSimSupported, bisSpecsForItem, HIT_CAP, MELEE_HIT_CAP,
} = require("../../src/config/councilSpecs");
const { CLASSES } = require("../../src/config/gameVersions/classes");

// Every spec #669 brought onto the council, with the role it plays there.
const NEW_SPECS = {
    "Warrior-Arms": "melee", "Warrior-Fury": "melee", "Warrior-Protection": "tank",
    "Rogue-Combat": "melee", "Rogue-Assassination": "melee", "Rogue-Subtlety": "melee",
    "Druid-Feral": "melee", "Druid-Guardian": "tank",
    "Shaman-Enhancement": "melee",
    "Paladin-Retribution": "melee", "Paladin-Protection": "tank",
    "Hunter-BeastMastery": "ranged", "Hunter-Marksmanship": "ranged", "Hunter-Survival": "ranged",
};

describe("config/councilSpecs", () => {
    it("is still reachable under its old name", () => {
        // casterSpecs.js re-exports this module, so a branch written against the
        // old name keeps working.
        expect(require("../../src/config/casterSpecs")).toBe(require("../../src/config/councilSpecs"));
    });

    describe("specFor", () => {
        it("resolves an exact class + spec pair", () => {
            expect(specFor("Priest", "Shadow")).toMatchObject({ key: "Priest-Shadow", role: "caster" });
            expect(specFor("Shaman", "Restoration")).toMatchObject({ key: "Shaman-Restoration", role: "healer" });
        });

        it("keeps the two Restoration specs apart by class", () => {
            expect(specFor("Druid", "Restoration").key).toBe("Druid-Restoration");
            expect(specFor("Shaman", "Restoration").key).toBe("Shaman-Restoration");
        });

        it("falls back to the class where every spec is a caster", () => {
            const mage = specFor("Mage", "");
            expect(mage).toMatchObject({ key: "Mage-Arcane", assumedFromClass: true });
            expect(specFor("Warlock", "").key).toBe("Warlock-Destruction");
        });

        it("refuses to guess when the class does not settle it", () => {
            // A priest without a spec could be shadow or holy — two different
            // councils and two different BiS lists.
            expect(specFor("Priest", "")).toBeNull();
            expect(specFor("Druid", "")).toBeNull();
            expect(specFor("Shaman", "")).toBeNull();
        });

        it("knows every tank, melee and hunter spec (#669)", () => {
            for (const [key, role] of Object.entries(NEW_SPECS)) {
                const [cls, spec] = key.split("-");
                expect(specFor(cls, spec)).toMatchObject({ key, role, className: cls, spec });
            }
        });

        it("reads a spec written with spaces the way Warcraft Logs keys it", () => {
            expect(specFor("Hunter", "Beast Mastery").key).toBe("Hunter-BeastMastery");
        });

        it("places a rogue or a hunter by class alone, never a warrior", () => {
            expect(specFor("Rogue", "")).toMatchObject({ key: "Rogue-Combat", assumedFromClass: true });
            expect(specFor("Hunter", "")).toMatchObject({ key: "Hunter-BeastMastery", assumedFromClass: true });
            // Fury or protection — the class does not say.
            expect(specFor("Warrior", "")).toBeNull();
            expect(specFor("Paladin", "")).toBeNull();
        });

        it("covers every spec the rule sets know", () => {
            // The "ohne Council-Spec" hint (#667) stays empty for anyone whose
            // spec is known: every class/spec of the TBC rule set has an entry.
            for (const cls of CLASSES) {
                for (const spec of cls.specs) expect(specByKey(`${cls.id}-${spec.id}`)).not.toBeNull();
            }
        });

        it("tolerates empty and unknown input", () => {
            expect(specFor("", "")).toBeNull();
            expect(specFor("Deathknight", "Blood")).toBeNull();
            expect(specFor("Mage", "Nonsense")).toMatchObject({ key: "Mage-Arcane" });
        });
    });

    describe("weightsFor", () => {
        it("values a spec's own school as highly as plain spell power", () => {
            const shadow = weightsFor(specByKey("Priest-Shadow"));
            expect(shadow.shadowPower).toBe(shadow.spellPower);
            // ...and does not hand that bonus to a spec of another school.
            expect(shadow.firePower).toBeUndefined();
        });

        it("uses the healing scale for healers", () => {
            const resto = weightsFor(specByKey("Druid-Restoration"));
            expect(resto.healingPower).toBe(1);
            expect(resto.mp5).toBeGreaterThan(weightsFor(specByKey("Priest-Shadow")).mp5);
        });

        it("weights hit at least as high as spell power for every DPS caster", () => {
            for (const spec of SPECS.filter((s) => s.role === "caster")) {
                const w = weightsFor(spec);
                expect(w.spellHit).toBeGreaterThanOrEqual(w.spellPower);
            }
        });

        it("judges physical damage on the attack-power scale", () => {
            for (const spec of SPECS.filter((s) => s.role === "melee" || s.role === "ranged")) {
                const w = weightsFor(spec);
                expect(w.attackPower).toBe(1);
                // Below the cap, hit is worth more than a point of attack power.
                expect(w.meleeHit).toBeGreaterThan(w.attackPower);
                // ...and spell power never outweighs it for anyone swinging a weapon.
                expect(w.spellPower || 0).toBeLessThan(w.attackPower);
            }
        });

        it("values the primary stat each class actually scales with", () => {
            // Strength is 2 AP for a warrior, 1 for a rogue, nothing for a hunter.
            expect(weightsFor(specByKey("Warrior-Fury")).strength).toBeGreaterThan(weightsFor(specByKey("Rogue-Combat")).strength);
            expect(weightsFor(specByKey("Hunter-BeastMastery")).strength || 0).toBe(0);
            expect(weightsFor(specByKey("Rogue-Combat")).agility).toBeGreaterThan(weightsFor(specByKey("Warrior-Fury")).agility);
            // A hunter's attack power counts for shots too.
            expect(weightsFor(specByKey("Hunter-Survival")).rangedAttackPower).toBe(1);
            expect(weightsFor(specByKey("Hunter-Survival")).agility).toBeGreaterThan(weightsFor(specByKey("Hunter-BeastMastery")).agility);
            // Feral attack power on a weapon is attack power in cat form.
            expect(weightsFor(specByKey("Druid-Feral")).feralAttackPower).toBe(1);
        });

        it("judges tanks on the stamina scale, defense first", () => {
            for (const spec of SPECS.filter((s) => s.role === "tank")) {
                const w = weightsFor(spec);
                expect(w.stamina).toBe(1);
                expect(w.defense).toBeGreaterThan(w.stamina);
                expect(w.dodge).toBeGreaterThan(0);
            }
            // A bear neither blocks nor parries, but its item armor counts five times.
            const bear = weightsFor(specByKey("Druid-Guardian"));
            expect(bear.parry).toBe(0);
            expect(bear.blockValue).toBe(0);
            expect(bear.armor).toBeGreaterThan(weightsFor(specByKey("Warrior-Protection")).armor);
            // A paladin's threat is holy damage.
            expect(weightsFor(specByKey("Paladin-Protection")).spellPower).toBeGreaterThan(0);
            expect(weightsFor(specByKey("Warrior-Protection")).spellPower || 0).toBe(0);
        });

        it("gives every role weights, even a spec without its own", () => {
            for (const spec of SPECS) {
                expect(Object.keys(weightsFor(spec)).length).toBeGreaterThan(5);
            }
        });
    });

    describe("hitCapFor", () => {
        it("subtracts talented hit from the gear cap", () => {
            expect(hitCapFor(specByKey("Priest-Shadow"))).toBeLessThan(HIT_CAP);
            // Destruction has no hit talents, so it needs the full cap from gear.
            expect(hitCapFor(specByKey("Warlock-Destruction"))).toBe(HIT_CAP);
        });

        it("is zero for healers, who have no hit cap to chase", () => {
            expect(hitCapFor(specByKey("Druid-Restoration"))).toBe(0);
            expect(hitCapFor(null)).toBe(0);
        });

        it("measures physical hit against the 9 % cap, less talented hit", () => {
            expect(MELEE_HIT_CAP).toBe(142);
            expect(hitCapFor(specByKey("Warrior-Arms"))).toBe(MELEE_HIT_CAP);
            expect(hitCapFor(specByKey("Hunter-BeastMastery"))).toBe(MELEE_HIT_CAP);
            // Precision (3 %), Precision (5 %), Dual Wield Specialization (6 %).
            expect(hitCapFor(specByKey("Warrior-Fury"))).toBe(95);
            expect(hitCapFor(specByKey("Rogue-Combat"))).toBe(63);
            expect(hitCapFor(specByKey("Shaman-Enhancement"))).toBe(47);
            for (const spec of SPECS.filter((s) => ["tank", "melee", "ranged"].includes(s.role))) {
                expect(hitCapFor(spec)).toBeGreaterThan(0);
                expect(hitCapFor(spec)).toBeLessThanOrEqual(MELEE_HIT_CAP);
            }
        });

        it("names the hit stat that counts for each role", () => {
            expect(hitStatFor(specByKey("Priest-Shadow"))).toBe("spellHit");
            expect(hitStatFor(specByKey("Warrior-Fury"))).toBe("meleeHit");
            // The item table carries one physical hit for melee and ranged.
            expect(hitStatFor(specByKey("Hunter-Survival"))).toBe("meleeHit");
            expect(hitStatFor(specByKey("Paladin-Protection"))).toBe("meleeHit");
            expect(hitStatFor(specByKey("Priest-Holy"))).toBe("");
            expect(hitStatFor(null)).toBe("");
        });
    });

    describe("bisForSpec", () => {
        it("returns the list of the requested tier when it exists", () => {
            const bis = bisForSpec(specByKey("Priest-Shadow"), "t6");
            expect(bis.exact).toBe(true);
            expect(bis.items.length).toBeGreaterThan(10);
            expect(bis.borrowedFrom).toBe("");
        });

        it("borrows another spec's list where WoWSims ships none", () => {
            const fire = bisForSpec(specByKey("Mage-Fire"), "t6");
            expect(fire.borrowedFrom).toBe("Mage-Arcane");
            expect(fire.items.length).toBeGreaterThan(10);
        });

        it("falls back to the newest earlier tier rather than to nothing", () => {
            // Priest-Shadow has no t65 list; t6 is the honest best answer.
            const bis = bisForSpec(specByKey("Priest-Shadow"), "t65");
            expect(bis.exact).toBe(false);
            expect(bis.tier).toBe("t6");
            expect(bis.items.length).toBeGreaterThan(0);
        });

        it("gives healers Wowhead's list and names it as such", () => {
            // Every healing gear set in WoWSims-TBC is an empty placeholder, so
            // these lists come from Wowhead's written guides instead. That the
            // source rides along matters: it is the difference between a
            // simulated loadout and a recommendation, and the page says which.
            for (const spec of SPECS.filter((s) => s.role === "healer")) {
                const bis = bisForSpec(spec, "t6");
                expect(bis.source).toBe("wowhead");
                expect(bis.items.length).toBeGreaterThan(10);
            }
            expect(bisForSpec(specByKey("Priest-Shadow"), "t6").source).toBe("wowsims");
        });

        it("lets Discipline borrow the priest healing list", () => {
            // Wowhead writes one priest healing list, not one per spec.
            const disc = bisForSpec(specByKey("Priest-Discipline"), "t6");
            expect(disc.borrowedFrom).toBe("Priest-Holy");
            expect(disc.items.length).toBeGreaterThan(10);
        });

        it("gives every new spec WoWSims' own list, borrowed where it has none", () => {
            for (const key of Object.keys(NEW_SPECS)) {
                const bis = bisForSpec(specByKey(key), "t6");
                expect(bis.source).toBe("wowsims");
                expect(bis.items.length).toBeGreaterThan(10);
            }
            expect(bisForSpec(specByKey("Rogue-Subtlety"), "t6").borrowedFrom).toBe("Rogue-Combat");
            expect(bisForSpec(specByKey("Hunter-Marksmanship"), "t6").borrowedFrom).toBe("Hunter-BeastMastery");
            expect(bisForSpec(specByKey("Warrior-Protection"), "t6").borrowedFrom).toBe("");
        });

        it("survives a null spec", () => {
            expect(bisForSpec(null, "t6")).toMatchObject({ items: [], tier: "" });
        });
    });

    describe("simulation support", () => {
        it("has a rotation for every DPS caster it claims to simulate", () => {
            for (const spec of SPECS.filter((s) => s.role === "caster")) {
                expect(aplForSpec(spec)).toBeTruthy();
                expect(isSimSupported(spec)).toBe(true);
            }
        });

        it("does not claim to simulate healers", () => {
            for (const spec of SPECS.filter((s) => s.role === "healer")) {
                expect(isSimSupported(spec)).toBe(false);
            }
        });

        it("does not claim to simulate tanks, melee or hunters yet — no rotation is vendored", () => {
            for (const key of Object.keys(NEW_SPECS)) {
                expect(aplForSpec(specByKey(key))).toBeNull();
                expect(isSimSupported(specByKey(key))).toBe(false);
            }
        });

        it("gives every simulated spec a talent string", () => {
            for (const spec of SPECS.filter((s) => isSimSupported(s))) {
                expect(typeof spec.talents).toBe("string");
                expect(spec.talents.length).toBeGreaterThan(10);
            }
        });
    });

    it("exposes the five roles the page filters by, and every spec plays one", () => {
        expect(ROLES.map((r) => r.id)).toEqual(["caster", "healer", "tank", "melee", "ranged"]);
        expect(ROLE_IDS).toEqual(ROLES.map((r) => r.id));
        for (const spec of SPECS) expect(ROLE_IDS).toContain(spec.role);
    });

    it("lists a hybrid's roles in the page's order and plans the raid build", () => {
        expect(rolesForClass("Warrior")).toEqual(["tank", "melee"]);
        expect(rolesForClass("Paladin")).toEqual(["healer", "tank", "melee"]);
        expect(rolesForClass("Druid")).toEqual(["caster", "healer", "tank", "melee"]);
        expect(rolesForClass("Hunter")).toEqual(["ranged"]);
        expect(specForRole("Warrior", "melee").key).toBe("Warrior-Fury");
        expect(specForRole("Druid", "tank").key).toBe("Druid-Guardian");
        expect(specForRole("Shaman", "melee").key).toBe("Shaman-Enhancement");
        expect(specForRole("Mage", "tank")).toBeNull();
    });

    it("maps every role to the gear family its sets are read as", () => {
        expect(gearFamilyFor("melee")).toBe("physical");
        expect(gearFamilyFor("ranged")).toBe("physical");
        expect(gearFamilyFor("tank")).toBe("tank");
        expect(gearFamilyFor("caster")).toBe("caster");
        expect(gearFamilyFor("healer")).toBe("healer");
        expect(gearFamilyFor("dragon")).toBe("");
    });

    it("has a unique key per spec", () => {
        const keys = SPECS.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe("config/councilSpecs — whose BiS list an item is on", () => {
    const wowsims = require("../../src/config/wowsims");
    const labelsFor = (id, tier) => bisSpecsForItem(id, tier).map((o) => o.label);

    it("names every spec whose list carries the item", () => {
        // Zhar'doom is on every caster list — the classic contested drop.
        const staff = 32374;
        const labels = labelsFor(staff, "t6");
        expect(labels).toEqual(expect.arrayContaining([
            "Schattenpriester", "Arkan-Magier", "Zerstörungs-Hexer",
            "Gleichgewichts-Druide", "Elementar-Schamane",
        ]));
    });

    it("folds a borrowing spec into the list it borrows from", () => {
        // Fire and Frost have no list of their own; showing them as separate
        // claims would turn five real answers into nine rows.
        const owners = bisSpecsForItem(32374, "t6");
        const mage = owners.find((o) => o.specKey === "Mage-Arcane");
        expect(mage.alsoFor).toEqual(expect.arrayContaining(["Feuer-Magier", "Frost-Magier"]));
        expect(owners.map((o) => o.specKey)).not.toContain("Mage-Fire");
    });

    it("answers per tier, not once and for all", () => {
        const bisT4 = wowsims.bisFor("Priest-Shadow", "t4").items[0].id;
        expect(labelsFor(bisT4, "t4")).toContain("Schattenpriester");
        // The same item is not automatically on the T6 list.
        const onT6 = wowsims.bisFor("Priest-Shadow", "t6").items.some((e) => e.id === bisT4);
        expect(labelsFor(bisT4, "t6").includes("Schattenpriester")).toBe(onT6);
    });

    it("returns nothing for an item on no list", () => {
        expect(bisSpecsForItem(999999, "t6")).toEqual([]);
        expect(bisSpecsForItem(0, "t6")).toEqual([]);
        expect(bisSpecsForItem(null, "t6")).toEqual([]);
    });

    it("never names a physical spec for a shadow priest's gear", () => {
        for (const id of wowsims.bisFor("Priest-Shadow", "t6").items.map((e) => e.id)) {
            for (const owner of bisSpecsForItem(id, "t6")) expect(owner.role).toBe("caster");
        }
    });

    it("names melee and hunters on their own lists, folding the borrowers in", () => {
        const fury = wowsims.bisFor("Warrior-Fury", "t6").items[0].id;
        expect(bisSpecsForItem(fury, "t6").map((o) => o.specKey)).toContain("Warrior-Fury");
        const combat = wowsims.bisFor("Rogue-Combat", "t6").items[0].id;
        const rogue = bisSpecsForItem(combat, "t6").find((o) => o.specKey === "Rogue-Combat");
        expect(rogue.role).toBe("melee");
        expect(rogue.alsoFor).toEqual(expect.arrayContaining(["Meucheln-Schurke", "Täuschungs-Schurke"]));
        const bm = wowsims.bisFor("Hunter-BeastMastery", "t6").items[0].id;
        expect(bisSpecsForItem(bm, "t6").find((o) => o.specKey === "Hunter-BeastMastery").role).toBe("ranged");
    });

    it("reports which tier's list it found, so a fallback is visible", () => {
        // Priest-Shadow has no t65 list; the answer comes from t6 and says so.
        const owners = bisSpecsForItem(wowsims.bisFor("Priest-Shadow", "t6").items[0].id, "t65");
        const shadow = owners.find((o) => o.specKey === "Priest-Shadow");
        if (shadow) expect(shadow.tier).toBe("t6");
    });
});
