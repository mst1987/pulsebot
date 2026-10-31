// Strength per raider for "Raids gleich stark" (#1038): pure helpers.
const {
    attachStrength, balanceCost, raidStrengths, itemLevelOf,
    CLASS_OF_ROLE, CLASS_FACTOR, CLASSES, GEAR_SHARE, ATTENDANCE_SHARE, NEUTRAL,
} = require("../../../src/utils/setup/raidStrength");

const cand = (userId, attendance, ...characters) => ({ userId, attendance, options: characters.map((character) => ({ character })) });

describe("raidStrength (#1038)", () => {
    it("has two shares adding up to 1 and weighs tanks and healers more than damage", () => {
        expect(GEAR_SHARE + ATTENDANCE_SHARE).toBeCloseTo(1);
        expect(NEUTRAL).toBe(0.5);
        expect(CLASSES).toBe(3);
        expect(CLASS_OF_ROLE).toEqual([0, 1, 2, 2]);
        expect(CLASS_FACTOR[0]).toBeGreaterThan(CLASS_FACTOR[2]);
        expect(CLASS_FACTOR[1]).toBeGreaterThan(CLASS_FACTOR[2]);
    });

    it("reads the stored item level per character key, positive numbers only", () => {
        const gear = { u1: { anna: 120, bert: 0 } };
        expect(itemLevelOf(gear, "u1", "Anna")).toBe(120);
        expect(itemLevelOf(gear, "u1", "Bert")).toBeNull();
        expect(itemLevelOf(gear, "u2", "Anna")).toBeNull();
        expect(itemLevelOf(null, "u1", "Anna")).toBeNull();
        expect(itemLevelOf({ u1: "x" }, "u1", "Anna")).toBeNull();
    });

    it("is neutral without any data and counts nobody as known", () => {
        const cands = [cand("u1", null, "Anna"), cand("u2", undefined, "Bert")];
        expect(attachStrength(cands, null)).toBe(0);
        for (const c of cands) expect(c.options[0].strength).toBeCloseTo(NEUTRAL);
        expect(cands[0].options[0].itemLevel).toBeUndefined();
    });

    it("scales the item level over the run and adds the attendance", () => {
        const cands = [cand("u1", 100, "Anna"), cand("u2", 0, "Bert"), cand("u3", null, "Cara", "Dora")];
        const gear = { u1: { anna: 130 }, u2: { bert: 110 }, u3: { cara: 120 } };
        expect(attachStrength(cands, gear)).toBe(3);
        expect(cands[0].options[0].strength).toBeCloseTo(1);
        expect(cands[1].options[0].strength).toBeCloseTo(0);
        // half way in gear, unknown attendance
        expect(cands[2].options[0].strength).toBeCloseTo(0.5);
        // a second character without a level is neutral in gear
        expect(cands[2].options[1].strength).toBeCloseTo(0.5);
    });

    it("clamps the attendance and gives everybody the same gear part when all levels match", () => {
        const cands = [cand("u1", 250, "Anna"), cand("u2", -5, "Bert")];
        attachStrength(cands, { u1: { anna: 120 }, u2: { bert: 120 } });
        expect(cands[0].options[0].strength).toBeCloseTo(GEAR_SHARE * NEUTRAL + ATTENDANCE_SHARE);
        expect(cands[1].options[0].strength).toBeCloseTo(GEAR_SHARE * NEUTRAL);
    });

    it("costs nothing for even raids and more for uneven tanks than for uneven damage", () => {
        // two raids, flat [event * CLASSES + class]
        const even = balanceCost(Float64Array.from([1, 1, 2, 1, 1, 2]), Float64Array.from([2, 2, 4, 2, 2, 4]), 2);
        expect(even).toBe(0);
        const tanks = balanceCost(Float64Array.from([2, 0, 0, 0, 0, 0]), Float64Array.from([2, 0, 0, 2, 0, 0]), 2);
        const damage = balanceCost(Float64Array.from([0, 0, 2, 0, 0, 0]), Float64Array.from([0, 0, 2, 0, 0, 2]), 2);
        expect(tanks).toBeCloseTo(2);
        expect(damage).toBeCloseTo(1);
        expect(balanceCost(new Float64Array(6), new Float64Array(6), 2)).toBe(0);
    });

    it("rounds the raid means to 0-100 and the spread between the strongest and the weakest", () => {
        expect(raidStrengths([[0.8, 0.6], [0.3], []])).toEqual({ spread: 40, strengths: [70, 30, null] });
        expect(raidStrengths([[0.5]])).toEqual({ spread: 0, strengths: [50] });
    });
});
