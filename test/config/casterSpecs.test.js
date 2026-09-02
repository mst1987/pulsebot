const {
    ROLES, SPECS, specFor, specByKey, isCasterSpec, weightsFor, hitCapFor,
    bisForSpec, aplForSpec, isSimSupported, bisSpecsForItem, HIT_CAP,
} = require("../../src/config/casterSpecs");

describe("config/casterSpecs", () => {
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

        it("leaves non-caster classes out entirely", () => {
            expect(specFor("Warrior", "Fury")).toBeNull();
            expect(specFor("Rogue", "Combat")).toBeNull();
            expect(specFor("Hunter", "Beast Mastery")).toBeNull();
            expect(specFor("Paladin", "Retribution")).toBeNull();
            expect(isCasterSpec("Warrior", "Arms")).toBe(false);
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

        it("reports an empty list for healers instead of inventing one", () => {
            // Every healing gear set in WoWSims-TBC is an empty placeholder.
            for (const spec of SPECS.filter((s) => s.role === "healer")) {
                expect(bisForSpec(spec, "t6").items).toEqual([]);
            }
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

        it("gives every simulated spec a talent string", () => {
            for (const spec of SPECS.filter((s) => isSimSupported(s))) {
                expect(typeof spec.talents).toBe("string");
                expect(spec.talents.length).toBeGreaterThan(10);
            }
        });
    });

    it("exposes exactly the two roles the page filters by", () => {
        expect(ROLES.map((r) => r.id)).toEqual(["caster", "healer"]);
        for (const spec of SPECS) expect(["caster", "healer"]).toContain(spec.role);
    });

    it("has a unique key per spec", () => {
        const keys = SPECS.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe("config/casterSpecs — whose BiS list an item is on", () => {
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

    it("never names a healer, who has no list at all", () => {
        for (const id of wowsims.bisFor("Priest-Shadow", "t6").items.map((e) => e.id)) {
            for (const owner of bisSpecsForItem(id, "t6")) expect(owner.role).toBe("caster");
        }
    });

    it("reports which tier's list it found, so a fallback is visible", () => {
        // Priest-Shadow has no t65 list; the answer comes from t6 and says so.
        const owners = bisSpecsForItem(wowsims.bisFor("Priest-Shadow", "t6").items[0].id, "t65");
        const shadow = owners.find((o) => o.specKey === "Priest-Shadow");
        if (shadow) expect(shadow.tier).toBe("t6");
    });
});
