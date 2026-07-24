const {
    buildSetupView, tankCandidates, isTankSpec, groupOf,
    enrichSlot, realClass, roleOf, classIconUrl,
} = require("../../src/utils/setupView.js");

describe("utils/setupView", () => {
    describe("enrichSlot", () => {
        it("resolves a spec by its classlist key and fills display fields", () => {
            const p = enrichSlot({ name: "Firemage", specName: "Fire" });
            expect(p).toMatchObject({
                name: "Firemage",
                specName: "Fire Mage",
                className: "Mage",
                classColor: "#69CCF0",
                role: "ranged",
            });
            // spec icon (Fire mage), not the generic class icon
            expect(p.iconUrl).toBe("https://wow.zamimg.com/images/wow/icons/large/spell_fire_firebolt02.jpg");
        });

        it("resolves a spec by its spec field too (not just the classlist key)", () => {
            // "Destruction" is the spec field of the "Destro" key.
            const p = enrichSlot({ specName: "Destruction", name: "Locky" });
            expect(p.className).toBe("Warlock");
            expect(p.role).toBe("ranged");
        });

        it("recovers the real class for tank specs whose clazz is generic 'Tank'", () => {
            const prot = enrichSlot({ name: "Pala", specName: "ProtPala" });
            expect(prot.className).toBe("Paladin");
            expect(prot.role).toBe("tank");
            expect(prot.iconUrl).toContain("spell_holy_devotionaura"); // prot-pala spec icon

            const blood = enrichSlot({ name: "Dk", specName: "BloodTank" });
            expect(blood.className).toBe("DK");
            expect(blood.iconUrl).toContain("spell_deathknight_bloodpresence"); // blood spec icon
            expect(blood.role).toBe("tank");
        });

        it("reads name/spec from alternative field names", () => {
            const p = enrichSlot({ charName: "Alt", className: "Feral" });
            expect(p.name).toBe("Alt");
            expect(p.className).toBe("Druid");
            expect(p.role).toBe("melee");
        });

        it("falls back gracefully for an unknown spec", () => {
            const p = enrichSlot({ name: "Mystery", specName: "Nonsense" });
            expect(p.specName).toBe("Nonsense");
            expect(p.className).toBe("");
            expect(p.classColor).toBe("");
            expect(p.iconUrl).toBe("");
            expect(p.role).toBe("dps");
        });
    });

    describe("roleOf / realClass helpers", () => {
        it("buckets by sodclazz", () => {
            expect(roleOf({ sodclazz: "Healer" })).toBe("healer");
            expect(roleOf({ sodclazz: "melee" })).toBe("melee");
            expect(roleOf({ sodclazz: "ranged" })).toBe("ranged");
            expect(roleOf({ clazz: "Tank" })).toBe("tank");
            expect(roleOf(null)).toBe("dps");
        });

        it("realClass returns null for an empty entry", () => {
            expect(realClass(null)).toBeNull();
        });

        it("classIconUrl returns '' for an unknown class", () => {
            expect(classIconUrl("Nope")).toBe("");
        });
    });

    describe("groupOf", () => {
        it("uses an explicit numeric slot.group when present", () => {
            expect(groupOf({ group: 3 }, 0)).toBe(3);
            expect(groupOf({ group: "4" }, 0)).toBe(4);
        });

        it("falls back to 5 slots per group by raw position", () => {
            expect(groupOf({}, 0)).toBe(1);
            expect(groupOf({}, 4)).toBe(1);
            expect(groupOf({}, 5)).toBe(2);
            expect(groupOf({}, 24)).toBe(5);
        });

        it("ignores a non-positive/garbage group value and uses position", () => {
            expect(groupOf({ group: 0 }, 7)).toBe(2);
            expect(groupOf({ group: "x" }, 12)).toBe(3);
        });
    });

    describe("buildSetupView", () => {
        // 11 slots => groups 1 (0-4), 2 (5-9), 3 (10). Slot index 3 is empty.
        const slots = [
            { name: "Tankadin", specName: "ProtPala" },
            { name: "Beary", specName: "Guardian" },
            { name: "Holypriest", specName: "Holy" },
            { name: "", specName: "Fire" }, // empty slot in group 1: dropped, no shift
            { name: "Stabby", specName: "Combat" },
            { name: "Firemage", specName: "Fire" },
            { name: "Shammyheal", specName: "RestoSham" },
            { name: "Warri", specName: "Fury" },
            { name: "Locky", specName: "Destruction" },
            { name: "Huntard", specName: "BM" },
            { name: "Latecomer", specName: "Frost" },
        ];

        it("groups players into raid groups 1-5 by position and counts them", () => {
            const view = buildSetupView(slots);
            expect(view.total).toBe(10);
            expect(view.groups.map((g) => g.group)).toEqual([1, 2, 3]);
            expect(view.groups[0].label).toBe("Gruppe 1");
            // group 1 keeps its 4 named players (the empty slot dropped without shifting)
            expect(view.groups[0].players.map((p) => p.name)).toEqual(["Tankadin", "Beary", "Holypriest", "Stabby"]);
            // slot index 10 lands in group 3, not merged up into group 2
            expect(view.groups[2].players.map((p) => p.name)).toEqual(["Latecomer"]);
        });

        it("honours an explicit slot.group over positional grouping", () => {
            const view = buildSetupView([
                { name: "A", specName: "Fire", group: 5 },
                { name: "B", specName: "Fire", group: 1 },
            ]);
            expect(view.groups.map((g) => g.group)).toEqual([1, 5]);
            expect(view.groups[1].players[0].name).toBe("A");
        });

        it("exposes a role breakdown for a summary", () => {
            const view = buildSetupView(slots);
            expect(view.roleCounts.tank).toBe(2);
            expect(view.roleCounts.healer).toBe(2);
        });

        it("drops empty slots (no name)", () => {
            const names = buildSetupView(slots).groups.flatMap((g) => g.players.map((p) => p.name));
            expect(names).not.toContain("");
            expect(names).toHaveLength(10);
        });

        it("tolerates a missing/empty slot list", () => {
            expect(buildSetupView(null)).toEqual({ total: 0, groups: [], roleCounts: {} });
            expect(buildSetupView([]).total).toBe(0);
        });
    });

    describe("tankCandidates / isTankSpec", () => {
        it("accepts explicit tank specs and off-tank-capable classes", () => {
            expect(isTankSpec({ sodclazz: "tank", clazz: "Tank" })).toBe(true); // prot pala
            expect(isTankSpec({ clazz: "Warrior" })).toBe(true);  // fury warrior can tank
            expect(isTankSpec({ clazz: "Druid" })).toBe(true);    // feral -> bear
            expect(isTankSpec({ clazz: "DK" })).toBe(true);
            expect(isTankSpec({ clazz: "Paladin" })).toBe(true);
        });

        it("rejects pure caster/healer classes and empty entries", () => {
            expect(isTankSpec({ clazz: "Mage" })).toBe(false);
            expect(isTankSpec({ clazz: "Priest" })).toBe(false);
            expect(isTankSpec(null)).toBe(false);
        });

        it("lists tank-capable raiders from a setup, deduped in order", () => {
            const cands = tankCandidates([
                { name: "Tankadin", specName: "ProtPala" }, // tank spec
                { name: "Beary", specName: "Guardian" },    // bear tank
                { name: "Warri", specName: "Fury" },        // warrior -> off-tank
                { name: "Firemage", specName: "Fire" },     // not a tank
                { name: "Warri", specName: "Fury" },        // duplicate name: dropped
                { name: "", specName: "ProtPala" },         // empty: dropped
            ]);
            expect(cands.map((c) => c.name)).toEqual(["Tankadin", "Beary", "Warri"]);
            expect(cands[0]).toMatchObject({ name: "Tankadin", className: "Paladin" });
        });

        it("returns [] for a missing slot list", () => {
            expect(tankCandidates(null)).toEqual([]);
        });
    });
});
