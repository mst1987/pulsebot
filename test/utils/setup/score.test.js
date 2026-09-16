const score = require("../../../src/utils/setup/score");
const { buildModel, limitFor, fairnessMap } = require("../../../src/utils/setup/model");
const { su } = require("./fixtures");

describe("setup score", () => {
    it("resolves weights: defaults, overrides, clamped", () => {
        const w = score.resolveWeights({ fairness: 0, wishes: 9999, status: -5, gear: "abc" });
        expect(w.fairness).toBe(0);
        expect(w.wishes).toBe(score.MAX_WEIGHT);
        expect(w.status).toBe(0);
        expect(w.gear).toBe(score.DEFAULT_WEIGHTS.gear);
        expect(w.mainSpec).toBe(score.DEFAULT_WEIGHTS.mainSpec);
    });

    it("keeps the hard constants above any weight setting", () => {
        const maxSoft = Object.keys(score.DEFAULT_WEIGHTS).length * score.MAX_WEIGHT;
        expect(score.BENCH_STATUS).toBeGreaterThan(maxSoft);
        expect(score.FILL).toBeGreaterThan(score.BENCH_STATUS);
        expect(score.ROLE_MIN).toBeGreaterThan(score.FILL);
    });

    it("reads composition entries as exact tanks/healers and dps minimums or ranges", () => {
        expect(limitFor("tank", 3)).toEqual({ min: 3, max: 3 });
        expect(limitFor("melee", 5)).toEqual({ min: 5, max: null });
        expect(limitFor("melee", 0)).toEqual({ min: 0, max: null });
        expect(limitFor("ranged", { min: 4, max: 2 })).toEqual({ min: 4, max: 4 });
        expect(limitFor("ranged", { min: 2, max: null })).toEqual({ min: 2, max: null });
    });

    it("derives fairness from the latest nights of each raider", () => {
        const map = fairnessMap([
            { eventId: "n2", startTime: 2, placed: ["a"], bench: ["b"] },
            { eventId: "n1", startTime: 1, placed: ["b"], bench: ["a", "c"] },
            { eventId: "now", startTime: 3, placed: [], bench: ["a"] },
        ], new Set(["now"]));
        expect(map.get("a")).toMatchObject({ last: "placed", benchCount: 1, nights: 2 });
        expect(map.get("b")).toMatchObject({ last: "bench", benchCount: 1 });
        expect(map.get("b").priority).toBeGreaterThan(map.get("a").priority);
        expect(map.get("c").priority).toBeGreaterThan(0);
    });

    describe("group buffs", () => {
        function groupValue(specs) {
            const signups = specs.map((spec, i) => su(`u${i}`, spec));
            const model = buildModel({ events: [{ id: "e", size: 5, composition: {} }], signups }, score.resolveWeights());
            const members = model.cands.map((c) => ({ cand: c, opt: c.options[0] }));
            const credit = [];
            return { value: score.groupBuffValue(model, members, credit), credit };
        }

        it("counts one air totem per shaman", () => {
            const one = groupValue(["Shaman-Enhancement", "Rogue-Combat", "Mage-Fire"]);
            const air = one.credit.filter((c) => c.buff.slot === "air");
            expect(air).toHaveLength(1);
            const two = groupValue(["Shaman-Enhancement", "Shaman-Elemental", "Rogue-Combat", "Mage-Fire", "Warlock-Destruction"]);
            const byShaman = Object.fromEntries(two.credit.filter((c) => c.buff.slot === "air").map((c) => [c.member.opt.spec, c.buff.key]));
            expect(byShaman).toEqual({ "Shaman-Enhancement": "windfury", "Shaman-Elemental": "wrathOfAir" });
            expect(two.value).toBeGreaterThan(one.value);
        });

        it("counts a buff only once per group", () => {
            const one = groupValue(["Druid-Balance", "Mage-Fire"]);
            const two = groupValue(["Druid-Balance", "Druid-Balance", "Mage-Fire"]);
            const moonkin = (r) => r.credit.filter((c) => c.buff.key === "moonkinAura");
            expect(moonkin(one)).toHaveLength(1);
            expect(moonkin(two)).toHaveLength(1);
        });

        it("prefers Mana Spring for casters over the universal Healing Stream", () => {
            const r = groupValue(["Shaman-Restoration", "Mage-Fire", "Warlock-Destruction", "Priest-Holy"]);
            const water = r.credit.filter((c) => c.buff.slot === "water").map((c) => c.buff.key);
            expect(water[0]).toBe("manaSpring");
        });
    });

    it("scores a broken hard rule as -Infinity", () => {
        const signups = [su("a", "Warrior-Protection"), su("b", "Paladin-Protection")];
        const model = buildModel({ events: [{ id: "e", size: 5, composition: { tank: 1, healer: 0 } }], signups }, score.resolveWeights());
        const scorer = score.makeScorer(model);
        expect(scorer.evaluate(Int32Array.from([0, -1]), Int32Array.from([0, -1]))).toBeGreaterThan(0);
        expect(scorer.evaluate(Int32Array.from([0, 0]), Int32Array.from([0, 0]))).toBe(-Infinity);
        expect(scorer.breakdown(Int32Array.from([0, 0]), Int32Array.from([0, 0]))).toBeNull();
    });
});
