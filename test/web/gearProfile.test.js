const { gearProfile, fitsRole, HEAL_RATIO, MIN_DPS_HIT } = require("../../src/web/gearProfile");
const wowsims = require("../../src/config/wowsims");

// Real sets, so the thresholds are checked against gear that exists rather than
// against numbers invented to fit them.
const gearOf = (ids) => ({ items: ids.map((itemId, slot) => ({ slot, itemId })) });

const dpsSet = gearOf(wowsims.bisFor("Priest-Shadow", "t6").items.map((e) => e.id));

// WoWSims ships no healer BiS (see fetch-wowsims-data.js), so a healing set is
// assembled from the item table: the pieces with the most healing power.
const healSet = gearOf(
    Object.entries(require("../../src/config/wowsims/casterItems.json").items)
        .filter(([, it]) => (it.stats.healingPower || 0) > 60 && !it.stats.spellHit && it.ilvl >= 120)
        .sort((a, b) => b[1].stats.healingPower - a[1].stats.healingPower)
        .slice(0, 16)
        .map(([id]) => Number(id)),
);

describe("web/gearProfile", () => {
    describe("telling the two kinds of caster set apart", () => {
        it("reads a shadow-priest BiS set as damage gear", () => {
            const p = gearProfile(dpsSet);
            expect(p.role).toBe("caster");
            expect(p.confident).toBe(true);
        });

        it("reads a healing set as healing gear", () => {
            // The case this module exists for: a shaman or druid who healed last
            // night would otherwise be judged on this set.
            const p = gearProfile(healSet);
            expect(p.role).toBe("healer");
            expect(p.confident).toBe(true);
        });

        it("separates them on both signals, not just one", () => {
            const dps = gearProfile(dpsSet);
            const heal = gearProfile(healSet);
            // On a damage item WoWSims models healing power and spell power as
            // equal, so the ratio sits near 1; a healing set is far above it.
            expect(dps.healRatio).toBeLessThan(HEAL_RATIO);
            expect(heal.healRatio).toBeGreaterThan(HEAL_RATIO);
            // ...and only a damage set chases the hit cap.
            expect(dps.spellHit).toBeGreaterThanOrEqual(MIN_DPS_HIT);
            expect(heal.spellHit).toBeLessThan(MIN_DPS_HIT);
        });
    });

    describe("when it cannot tell", () => {
        it("gives no verdict on too few known items", () => {
            // A raider in mostly unknown gear gets no answer rather than a coin
            // flip that decides which report is used.
            const p = gearProfile(gearOf([31064, 31065]));
            expect(p.role).toBe("");
            expect(p.confident).toBe(false);
        });

        it("survives empty and unknown input", () => {
            expect(gearProfile(null).role).toBe("");
            expect(gearProfile({ items: [] }).role).toBe("");
            expect(gearProfile(gearOf([999999, 999998, 999997, 999996, 999995])).role).toBe("");
        });

        it("flags a set whose two signals disagree", () => {
            // A healing set with hit gear still on it: the ratio decides, but
            // the answer says it is not sure.
            const mixed = gearOf([
                ...healSet.items.slice(0, 10).map((i) => i.itemId),
                // Two pieces carrying hit.
                ...wowsims.bisFor("Priest-Shadow", "t6").items
                    .filter((e) => (wowsims.item(e.id) || { stats: {} }).stats.spellHit > 20)
                    .slice(0, 3)
                    .map((e) => e.id),
            ]);
            const p = gearProfile(mixed);
            if (p.spellHit >= MIN_DPS_HIT && p.healRatio >= HEAL_RATIO) {
                expect(p.confident).toBe(false);
            }
        });
    });

    describe("fitsRole", () => {
        it("accepts a set of the right role", () => {
            expect(fitsRole(gearProfile(dpsSet), "caster")).toBe(true);
            expect(fitsRole(gearProfile(healSet), "healer")).toBe(true);
        });

        it("refuses a confident mismatch — that is the whole point", () => {
            expect(fitsRole(gearProfile(healSet), "caster")).toBe(false);
            expect(fitsRole(gearProfile(dpsSet), "healer")).toBe(false);
        });

        it("lets an uncertain verdict pass rather than leaving a raider bare", () => {
            // Rejecting it would mean no gear at all, and last night's slightly
            // odd set still says more than nothing.
            expect(fitsRole({ role: "healer", confident: false }, "caster")).toBe(true);
        });

        it("accepts anything when no role is asked for or none could be read", () => {
            expect(fitsRole(gearProfile(healSet), "")).toBe(true);
            expect(fitsRole({ role: "", confident: false }, "caster")).toBe(true);
        });
    });
});
