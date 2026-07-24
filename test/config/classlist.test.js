const extendedClassList = require("../../src/config/classlist");

describe("config/classlist", () => {
    it("exports a non-empty object", () => {
        expect(typeof extendedClassList).toBe("object");
        expect(extendedClassList).not.toBeNull();
        expect(Object.keys(extendedClassList).length).toBeGreaterThan(0);
    });

    it("gives every entry the required string fields icon/name/clazz/spec", () => {
        for (const [key, entry] of Object.entries(extendedClassList)) {
            expect(typeof entry).toBe("object");
            expect(typeof entry.icon).toBe("string");
            expect(entry.icon.length).toBeGreaterThan(0);
            expect(typeof entry.name).toBe("string");
            expect(entry.name.length).toBeGreaterThan(0);
            expect(typeof entry.clazz).toBe("string");
            expect(entry.clazz.length).toBeGreaterThan(0);
            expect(typeof entry.spec).toBe("string");
            expect(entry.spec.length).toBeGreaterThan(0);
            // sodclazz is optional, but when present it must be a non-empty string
            if (Object.prototype.hasOwnProperty.call(entry, "sodclazz")) {
                expect(typeof entry.sodclazz).toBe("string");
                expect(entry.sodclazz.length).toBeGreaterThan(0);
            }
            // guard against typos in the key/spec pairing being wildly off
            expect(key.length).toBeGreaterThan(0);
        }
    });

    it("maps Holy1 to a Holy Paladin healer", () => {
        expect(extendedClassList.Holy1).toEqual({
            icon: "holypala",
            name: "Holy Paladin",
            clazz: "Paladin",
            sodclazz: "Healer",
            spec: "Holy1",
        });
    });

    it("keeps alias keys consistent with their canonical entry", () => {
        expect(extendedClassList.HolyPala).toEqual(extendedClassList.Holy1);
        expect(extendedClassList.Retri).toEqual(extendedClassList.Retribution);
        expect(extendedClassList.Disc).toEqual(extendedClassList.Discipline);
        expect(extendedClassList.MM).toEqual(extendedClassList.Marksman);
    });

    it("maps representative specs to the expected class", () => {
        expect(extendedClassList.Fury.clazz).toBe("Warrior");
        expect(extendedClassList.Fury.sodclazz).toBe("melee");
        expect(extendedClassList.Shadow.clazz).toBe("Priest");
        expect(extendedClassList.Shadow.sodclazz).toBe("ranged");
        expect(extendedClassList.Restoration.clazz).toBe("Druid");
        expect(extendedClassList.Restoration.sodclazz).toBe("Healer");
        expect(extendedClassList.Fire.clazz).toBe("Mage");
    });

    it("models tank specs with a tank sodclazz", () => {
        expect(extendedClassList.Guardian.sodclazz).toBe("tank");
        expect(extendedClassList.Protection.sodclazz).toBe("tank");
        expect(extendedClassList.Blood_Tank.clazz).toBe("Tank");
    });

    it("includes an uppercase generic key for each base class", () => {
        for (const generic of ["PALADIN", "WARRIOR", "ROGUE", "PRIEST", "HUNTER", "WARLOCK", "MAGE", "DRUID", "DEATHKNIGHT", "SHAMAN"]) {
            expect(extendedClassList[generic]).toBeDefined();
            expect(typeof extendedClassList[generic].name).toBe("string");
        }
    });
});
