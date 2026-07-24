const {
    buildSetupView, enrichSlot, realClass, roleOf, classIconUrl,
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
            expect(p.iconUrl).toBe("https://wow.zamimg.com/images/wow/icons/large/classicon_mage.jpg");
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
            expect(prot.iconUrl).toContain("classicon_paladin");

            const blood = enrichSlot({ name: "Dk", specName: "BloodTank" });
            expect(blood.className).toBe("DK");
            expect(blood.iconUrl).toContain("classicon_deathknight");
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

    describe("buildSetupView", () => {
        const slots = [
            { name: "Tankadin", specName: "ProtPala" },
            { name: "Beary", specName: "Guardian" },
            { name: "Holypriest", specName: "Holy" },
            { name: "Shammyheal", specName: "RestoSham" },
            { name: "Stabby", specName: "Combat" },
            { name: "Firemage", specName: "Fire" },
            { name: "", specName: "Fire" }, // empty slot: dropped
        ];

        it("groups players by role in tank→healer→melee→ranged order and counts them", () => {
            const view = buildSetupView(slots);
            expect(view.total).toBe(6);
            expect(view.groups.map((g) => g.role)).toEqual(["tank", "healer", "melee", "ranged"]);
            expect(view.counts).toEqual({ tank: 2, healer: 2, melee: 1, ranged: 1 });
            expect(view.groups[0].label).toBe("Tanks");
        });

        it("drops empty slots (no name)", () => {
            const view = buildSetupView(slots);
            const names = view.groups.flatMap((g) => g.players.map((p) => p.name));
            expect(names).not.toContain("");
            expect(names).toHaveLength(6);
        });

        it("tolerates a missing/empty slot list", () => {
            expect(buildSetupView(null)).toEqual({ total: 0, counts: {}, groups: [] });
            expect(buildSetupView([]).total).toBe(0);
        });
    });
});
