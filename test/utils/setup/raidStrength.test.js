// Strength per raider for "Raids gleich stark" (#1038): pure helpers.
const {
    attachStrength, balanceCost, raidStrengths, itemLevelOf, spanOf, ITEM_LEVEL_SPAN, TOLERANCE,
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

    it("puts the item level on a fixed scale around the centre and adds the attendance", () => {
        const cands = [cand("u1", 100, "Anna"), cand("u2", 0, "Bert"), cand("u3", null, "Cara", "Dora")];
        const gear = { u1: { anna: 130 }, u2: { bert: 110 }, u3: { cara: 120 } };
        expect(attachStrength(cands, gear)).toBe(3);
        // centre 120, span 25: 130 is 0.9 in gear, 110 is 0.1
        expect(cands[0].options[0].strength).toBeCloseTo(GEAR_SHARE * 0.9 + ATTENDANCE_SHARE);
        expect(cands[1].options[0].strength).toBeCloseTo(GEAR_SHARE * 0.1);
        // at the centre in gear, unknown attendance
        expect(cands[2].options[0].strength).toBeCloseTo(0.5);
        // a second character without a level is neutral in gear
        expect(cands[2].options[1].strength).toBeCloseTo(0.5);
    });

    it("a small spread moves nobody far: 20 raiders between 115.0 and 115.9 stay within a few hundredths", () => {
        const cands = Array.from({ length: 20 }, (_, i) => cand(`u${i}`, 50, `c${i}`));
        const gear = Object.fromEntries(cands.map((c, i) => [c.userId, { [`c${i}`]: 115 + (i % 10) / 10 }]));
        attachStrength(cands, gear);
        const s = cands.map((c) => c.options[0].strength);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThan(0.03);
    });

    it("the span comes from the version, else the default", () => {
        expect(spanOf({ balanceItemLevelSpan: 10 })).toBe(10);
        expect(spanOf({})).toBe(ITEM_LEVEL_SPAN);
        expect(spanOf(null)).toBe(ITEM_LEVEL_SPAN);
        const cands = [cand("u1", null, "Anna"), cand("u2", null, "Bert")];
        attachStrength(cands, { u1: { anna: 125 }, u2: { bert: 115 } }, { span: 10 });
        expect(cands[0].options[0].strength).toBeCloseTo(GEAR_SHARE * 1 + ATTENDANCE_SHARE * NEUTRAL);
    });

    it("an outlier in the pool does not change the strength of the others", () => {
        const make = () => [cand("u1", 80, "Anna"), cand("u2", 80, "Bert"), cand("u3", 80, "Cara")];
        const gear = { u1: { anna: 120 }, u2: { bert: 121 }, u3: { cara: 122 } };
        const plain = make();
        attachStrength(plain, gear);
        const withTwink = [...make(), cand("u4", 80, "Twink")];
        attachStrength(withTwink, { ...gear, u4: { twink: 60 } });
        for (let i = 0; i < 3; i++) expect(withTwink[i].options[0].strength).toBeCloseTo(plain[i].options[0].strength, 10);
        expect(withTwink[3].options[0].strength).toBeCloseTo(ATTENDANCE_SHARE * 0.8);
    });

    it("skewed levels: an unknown raider sits at the mean of the known, not half way between the extremes", () => {
        const cands = [cand("u1", null, "A"), cand("u2", null, "B"), cand("u3", null, "C"), cand("u4", null, "D"), cand("u5", null, "Unknown")];
        attachStrength(cands, { u1: { a: 120 }, u2: { b: 120 }, u3: { c: 120 }, u4: { d: 140 } });
        // mean 125: the unknown is as strong as a raider at 125, the three at 120 below it
        expect(cands[4].options[0].strength).toBeCloseTo(0.5);
        expect(cands[0].options[0].strength).toBeCloseTo(GEAR_SHARE * (0.5 - 5 / 25) + ATTENDANCE_SHARE * NEUTRAL);
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
        // |2 - 1| per raid, less TOLERANCE per raider, in both raids
        expect(tanks).toBeCloseTo(2 * (1 - 2 * TOLERANCE));
        expect(damage).toBeCloseTo(tanks / 2);
        expect(balanceCost(new Float64Array(6), new Float64Array(6), 2)).toBe(0);
    });

    it("noise threshold: raids within TOLERANCE per raider of the mean cost nothing", () => {
        expect(TOLERANCE).toBeGreaterThan(0);
        const near = balanceCost(Float64Array.from([0, 0, 1.05, 0, 0, 0.95]), Float64Array.from([0, 0, 2, 0, 0, 2]), 2);
        expect(near).toBe(0);
        const far = balanceCost(Float64Array.from([0, 0, 1.2, 0, 0, 0.8]), Float64Array.from([0, 0, 2, 0, 0, 2]), 2);
        expect(far).toBeGreaterThan(0);
    });

    it("the raid strength over placed raiders only, 0-100, and the spread between the strongest and the weakest", () => {
        // three raids, damage only: two at 0.8, two at 0.3, nobody
        const sum = Float64Array.from([0, 0, 1.6, 0, 0, 0.6, 0, 0, 0]);
        const count = Float64Array.from([0, 0, 2, 0, 0, 2, 0, 0, 0]);
        expect(raidStrengths(sum, count, 3)).toEqual({ spread: 50, strengths: [80, 30, null] });
        expect(raidStrengths(Float64Array.from([0, 0, 0.5]), Float64Array.from([0, 0, 1]), 1)).toEqual({ spread: 0, strengths: [50] });
    });

    it("the raid strength measures like the cost: each class at its mean gives the same number", () => {
        // raid 1: strong tank, raid 2: weak tank - the tank weighs more than the damage
        const r = raidStrengths(Float64Array.from([0.9, 0, 0.2, 0.1, 0, 0.8]), Float64Array.from([1, 0, 1, 1, 0, 1]), 2);
        expect(r.strengths[0]).toBeGreaterThan(r.strengths[1]);
        const even = raidStrengths(Float64Array.from([0.6, 0, 0.8, 0.6, 0, 0.8]), Float64Array.from([1, 0, 2, 1, 0, 2]), 2);
        expect(even.strengths[0]).toBe(even.strengths[1]);
        expect(even.spread).toBe(0);
    });
});
