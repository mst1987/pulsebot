const { CLASSES, getClass } = require("../../src/config/applyClasses");

describe("config/applyClasses", () => {
    it("exports CLASSES as an array and getClass as a function", () => {
        expect(Array.isArray(CLASSES)).toBe(true);
        expect(CLASSES.length).toBe(9);
        expect(typeof getClass).toBe("function");
    });

    it("gives every class value/label/icon strings and a specs array of 3", () => {
        for (const c of CLASSES) {
            expect(typeof c.value).toBe("string");
            expect(c.value.length).toBeGreaterThan(0);
            expect(typeof c.label).toBe("string");
            expect(c.label.length).toBeGreaterThan(0);
            expect(typeof c.icon).toBe("string");
            expect(c.icon.length).toBeGreaterThan(0);
            expect(Array.isArray(c.specs)).toBe(true);
            expect(c.specs.length).toBe(3);
            for (const spec of c.specs) {
                expect(typeof spec).toBe("string");
                expect(spec.length).toBeGreaterThan(0);
            }
        }
    });

    it("uses unique lowercase class values", () => {
        const values = CLASSES.map((c) => c.value);
        expect(new Set(values).size).toBe(values.length);
        for (const v of values) {
            expect(v).toBe(v.toLowerCase());
        }
    });

    it("covers the nine WoW base classes", () => {
        const values = CLASSES.map((c) => c.value).sort();
        expect(values).toEqual(
            ["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"],
        );
    });

    it("getClass returns the matching class for a known value", () => {
        const paladin = getClass("paladin");
        expect(paladin).not.toBeNull();
        expect(paladin.label).toBe("Paladin");
        expect(paladin.specs).toEqual(["Holy", "Protection", "Retribution"]);
    });

    it("getClass returns null for an unknown value", () => {
        expect(getClass("demonhunter")).toBeNull();
        expect(getClass("")).toBeNull();
        expect(getClass(undefined)).toBeNull();
    });
});
