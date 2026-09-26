const classlist = require("../../src/config/classlist");
const { CLASSES, RAID_HELPER_ONLY_CLASSES, RAID_HELPER_NAMES, ROLES } = require("../../src/config/gameVersions/classes");

const ALL_CLASSES = [...CLASSES, ...RAID_HELPER_ONLY_CLASSES];

describe("config/classlist", () => {
    it("is an alias table onto rule-set keys", () => {
        expect(Object.keys(classlist.ALIASES)).toHaveLength(66);
        for (const [alias, key] of Object.entries(classlist.ALIASES)) {
            const [classId, specId] = key.split("-");
            const cls = ALL_CLASSES.find((c) => c.id === classId);
            expect({ alias, cls: !!cls }).toEqual({ alias, cls: true });
            if (specId) expect(cls.specs.some((s) => s.id === specId)).toBe(true);
            expect(RAID_HELPER_NAMES[key]).toBeDefined();
        }
    });

    it("names every spec of the rule set", () => {
        const targets = new Set(Object.values(classlist.ALIASES));
        for (const cls of CLASSES) {
            for (const spec of cls.specs) expect(targets.has(`${cls.id}-${spec.id}`)).toBe(true);
        }
    });

    it("resolves an alias to class, role and Raid-Helper's names", () => {
        expect(classlist.entryFor("Holy1")).toEqual({
            key: "Paladin-Holy",
            clazz: "Paladin",
            role: "healer",
            spec: "Holy1",
            icon: "holypala",
            name: "Holy Paladin",
            raidhelperClass: "Paladin",
        });
        expect(classlist.entryFor("HolyPala")).toEqual(classlist.entryFor("Holy1"));
        expect(classlist.entryFor("Destro")).toMatchObject({ key: "Warlock-Destruction", role: "ranged", spec: "Destruction" });
    });

    it("takes class and role from gameVersions/classes.js", () => {
        for (const entry of Object.values(classlist.ENTRIES)) {
            const [classId, specId] = entry.key.split("-");
            expect(entry.clazz).toBe(classId);
            if (!specId) {
                expect(entry.role).toBe("");
                continue;
            }
            expect(ROLES).toContain(entry.role);
        }
        expect(classlist.entryFor("Survival").role).toBe("ranged");
        expect(classlist.entryFor("Guardian").role).toBe("tank");
    });

    it("keeps the Season-of-Discovery tank runes as tanks", () => {
        for (const alias of Object.keys(classlist.ROLE_OVERRIDES)) expect(classlist.entryFor(alias).role).toBe("tank");
        expect(classlist.entryFor("TankRogue")).toMatchObject({ key: "Rogue-Combat", clazz: "Rogue" });
        expect(classlist.entryFor("Combat").role).toBe("melee");
    });

    it("keeps Raid-Helper's own \"Tank\" class for the API", () => {
        expect(classlist.entryFor("ProtPala")).toMatchObject({ clazz: "Paladin", raidhelperClass: "Tank" });
        expect(classlist.entryFor("Protection")).toMatchObject({ clazz: "Warrior", raidhelperClass: "Warrior", role: "tank" });
        expect(classlist.entryFor("Guardian").raidhelperClass).toBe("Druid");
    });

    it("resolves class-only names", () => {
        expect(classlist.entryFor("PALADIN")).toMatchObject({ key: "Paladin", clazz: "Paladin", role: "", spec: "paladin" });
        expect(classlist.entryFor("HUNTER")).toMatchObject({ key: "Hunter-Survival", spec: "Survival" });
        expect(classlist.entryFor("DEATHKNIGHT")).toMatchObject({ key: "DK", clazz: "DK" });
    });

    describe("entryFor / entryForSpec", () => {
        it("returns null for unknown or inherited names", () => {
            for (const name of ["", "Unknown", "toString", "constructor", null, undefined]) {
                expect(classlist.entryFor(name)).toBeNull();
                expect(classlist.entryForSpec(name)).toBeNull();
            }
        });

        it("takes only aliases in entryFor, also Raid-Helper's spec names in entryForSpec", () => {
            expect(classlist.entryFor("Destruction")).toBeNull();
            expect(classlist.entryForSpec("Destruction")).toBe(classlist.entryFor("Destro"));
            expect(classlist.entryForSpec("Unholy_DPS")).toBe(classlist.entryFor("Unholy_DPS"));
            expect(classlist.entryForSpec("paladin")).toBe(classlist.entryFor("PALADIN"));
            // An alias wins over a spec name: "Combat" is the melee rogue, not the tank rune.
            expect(classlist.entryForSpec("Combat")).toBe(classlist.entryFor("Combat"));
        });
    });

    it("refuses an alias whose key the class table does not describe", () => {
        jest.isolateModules(() => {
            jest.doMock("../../src/config/gameVersions/classes", () => {
                const actual = jest.requireActual("../../src/config/gameVersions/classes");
                const names = { ...actual.RAID_HELPER_NAMES };
                delete names["Paladin-Holy"];
                return { ...actual, RAID_HELPER_NAMES: names };
            });
            expect(() => require("../../src/config/classlist")).toThrow("classlist: unknown key Paladin-Holy for Holy1");
        });
        jest.dontMock("../../src/config/gameVersions/classes");
    });

    it("freezes its entries", () => {
        expect(Object.isFrozen(classlist.entryFor("Fury"))).toBe(true);
    });
});
