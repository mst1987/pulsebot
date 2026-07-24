const claData = require("../../src/config/claData");

describe("config/claData", () => {
    it("exports the expected reference structures", () => {
        for (const key of [
            "ENCHANTABLE_SLOTS",
            "GEM_QUALITY",
            "META_GEM_IDS",
            "YELLOW_GEM_IDS",
            "RED_GEM_IDS",
            "BLUE_GEM_IDS",
            "UNCUT_GEM_IDS",
            "ACCEPTABLE_UNCOMMON_GEM_IDS",
            "ACCEPTABLE_RARE_GEM_IDS",
            "ITEMS_WITHOUT_ENCHANT",
            "ENCHANT_BLACKLIST",
            "EXCLUDED_GEAR",
            "SOCKETS",
            "SHADOW_RESISTANCE",
            "CONSUMABLES",
        ]) {
            expect(claData[key]).toBeDefined();
        }
    });

    it("models ENCHANTABLE_SLOTS as a non-empty array of numbers", () => {
        expect(Array.isArray(claData.ENCHANTABLE_SLOTS)).toBe(true);
        expect(claData.ENCHANTABLE_SLOTS.length).toBeGreaterThan(0);
        for (const slot of claData.ENCHANTABLE_SLOTS) {
            expect(typeof slot).toBe("number");
            expect(Number.isInteger(slot)).toBe(true);
        }
    });

    it("orders GEM_QUALITY thresholds ignore < ... < epic", () => {
        expect(claData.GEM_QUALITY).toEqual({
            ignore: 0,
            common: 1,
            uncommon: 2,
            rare: 3,
            epic: 4,
        });
    });

    it("stores the gem id groups as non-empty arrays of numeric-id strings", () => {
        for (const key of ["META_GEM_IDS", "YELLOW_GEM_IDS", "RED_GEM_IDS", "BLUE_GEM_IDS", "UNCUT_GEM_IDS"]) {
            const list = claData[key];
            expect(Array.isArray(list)).toBe(true);
            expect(list.length).toBeGreaterThan(0);
            for (const id of list) {
                expect(typeof id).toBe("string");
                expect(id).toMatch(/^\d+$/);
            }
        }
    });

    it("shapes ENCHANT_BLACKLIST entries as {id, slot, name}", () => {
        expect(Array.isArray(claData.ENCHANT_BLACKLIST)).toBe(true);
        expect(claData.ENCHANT_BLACKLIST.length).toBeGreaterThan(0);
        for (const entry of claData.ENCHANT_BLACKLIST) {
            expect(typeof entry.id).toBe("string");
            expect(typeof entry.name).toBe("string");
            expect(entry.name.length).toBeGreaterThan(0);
            // slot is either a numeric-id string or explicitly null
            expect(entry.slot === null || typeof entry.slot === "string").toBe(true);
        }
    });

    it("shapes EXCLUDED_GEAR entries as {id, name}", () => {
        expect(Array.isArray(claData.EXCLUDED_GEAR)).toBe(true);
        expect(claData.EXCLUDED_GEAR.length).toBeGreaterThan(0);
        for (const entry of claData.EXCLUDED_GEAR) {
            expect(typeof entry.id).toBe("string");
            expect(typeof entry.name).toBe("string");
            expect(entry.name.length).toBeGreaterThan(0);
        }
    });

    it("maps SOCKETS itemId -> socket count in the 1..3 range", () => {
        const entries = Object.entries(claData.SOCKETS);
        expect(entries.length).toBeGreaterThan(0);
        for (const [itemId, count] of entries) {
            expect(itemId).toMatch(/^\d+$/);
            expect(typeof count).toBe("number");
            expect(count).toBeGreaterThanOrEqual(1);
            expect(count).toBeLessThanOrEqual(3);
        }
    });

    it("maps SHADOW_RESISTANCE itemId -> positive number", () => {
        const entries = Object.entries(claData.SHADOW_RESISTANCE);
        expect(entries.length).toBeGreaterThan(0);
        for (const [itemId, value] of entries) {
            expect(itemId).toMatch(/^\d+$/);
            expect(typeof value).toBe("number");
            expect(value).toBeGreaterThan(0);
        }
    });

    it("groups CONSUMABLES into spell-id arrays for each expected category", () => {
        for (const category of ["battleElixir", "guardianElixir", "flask", "food", "jcNeck"]) {
            const list = claData.CONSUMABLES[category];
            expect(Array.isArray(list)).toBe(true);
            expect(list.length).toBeGreaterThan(0);
            for (const id of list) {
                expect(id).toMatch(/^\d+$/);
            }
        }
    });
});
