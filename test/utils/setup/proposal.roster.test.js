// The setup proposal and the roster (#658): in a category with a roster, core
// comes before trial before bench, everyone else after; without a roster the
// proposal is what it was.
const { buildSetupProposal } = require("../../../src/utils/setup/proposal");
const { su } = require("./fixtures");

const EVENT = { id: "ev", title: "Roster-Test", size: 5, composition: { tank: 0, healer: 0, melee: 0, ranged: 0 } };

/** Eight mages for five places - the non-members signed up first, so they win every tie by time. */
function signups() {
    return [
        su("stranger1", "Mage-Arcane", { at: 1 }),
        su("stranger2", "Mage-Arcane", { at: 2 }),
        su("bench1", "Mage-Arcane", { at: 3 }),
        su("bench2", "Mage-Arcane", { at: 4 }),
        su("trial1", "Mage-Arcane", { at: 5 }),
        su("trial2", "Mage-Arcane", { at: 6 }),
        su("core1", "Mage-Arcane", { at: 7 }),
        su("core2", "Mage-Arcane", { at: 8 }),
    ];
}
const ROSTER = { core1: "core", core2: "core", trial1: "trial", trial2: "trial", bench1: "bench", bench2: "bench", paused: "pause" };

const placed = (out) => out.groups.flatMap((g) => g.slots.map((s) => s.userId)).sort();

describe("setup proposal: roster status (#658)", () => {
    it("places core before trial before bench, non-members after", () => {
        const out = buildSetupProposal({ versionId: "tbc", events: [EVENT], signups: signups(), rosterStatus: ROSTER });
        const ids = placed(out);
        expect(ids).toHaveLength(5);
        expect(ids).toEqual(expect.arrayContaining(["core1", "core2", "trial1", "trial2"]));
        expect(ids.filter((id) => id.startsWith("bench"))).toHaveLength(1);
        expect(ids.some((id) => id.startsWith("stranger"))).toBe(false);
        expect(out.pool.map((p) => p.userId)).toEqual(expect.arrayContaining(["stranger1", "stranger2"]));
        expect(out.weights.roster).toBe(200);
        expect(out.score.parts.roster).toBeGreaterThan(0);
    });

    it("keeps the old order without a roster: nobody has a status, the weight is off", () => {
        const out = buildSetupProposal({ versionId: "tbc", events: [EVENT], signups: signups() });
        expect(out.weights.roster).toBe(0);
        expect(out.score.parts.roster).toBe(0);
        const again = buildSetupProposal({ versionId: "tbc", events: [EVENT], signups: signups(), rosterStatus: {} });
        expect(placed(again)).toEqual(placed(out));
    });

    it("treats a paused member and unknown statuses like non-members, and the weight can be turned off", () => {
        const statuses = { stranger1: "pause", stranger2: "chef" };
        const withPause = buildSetupProposal({ versionId: "tbc", events: [EVENT], signups: signups(), rosterStatus: statuses });
        expect(withPause.weights.roster).toBe(0);
        const off = buildSetupProposal({ versionId: "tbc", events: [EVENT], signups: signups(), rosterStatus: ROSTER }, { weights: { roster: 0 } });
        expect(off.weights.roster).toBe(0);
        expect(off.score.parts.roster).toBe(0);
    });
});
