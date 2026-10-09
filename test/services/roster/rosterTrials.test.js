// rosterTrials (#658): trials ending within a week or overdue, and the new end of an extended one.
const { trialEnding, extendedTrialUntil, TRIAL_HINT_DAYS, TRIAL_EXTEND_DAYS } = require("../../../src/services/roster/rosterTrials");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

function roster(members) {
    return { id: "r1", members };
}

describe("services/roster/rosterTrials trialEnding", () => {
    it("lists trial members ending within the next week or overdue, the earliest first", () => {
        const r = roster({
            a: { status: "trial", trialUntil: iso(NOW + 3 * DAY) },
            b: { status: "trial", trialUntil: iso(NOW - 2 * DAY) },
            c: { status: "trial", trialUntil: iso(NOW + 10 * DAY) },
            d: { status: "core", trialUntil: iso(NOW + 1 * DAY) },
            e: { status: "trial", trialUntil: null },
            f: { status: "trial", trialUntil: "kaputt" },
        });
        expect(TRIAL_HINT_DAYS).toBe(7);
        expect(trialEnding(r, { now: NOW, nameOf: (id) => id.toUpperCase() })).toEqual([
            { userId: "b", displayName: "B", trialUntil: iso(NOW - 2 * DAY), overdue: true },
            { userId: "a", displayName: "A", trialUntil: iso(NOW + 3 * DAY), overdue: false },
        ]);
    });

    it("takes the id as the name without a lookup and copes with no roster", () => {
        expect(trialEnding(roster({ x: { status: "trial", trialUntil: iso(NOW) } }), { now: NOW })[0].displayName).toBe("x");
        expect(trialEnding(null, { now: NOW })).toEqual([]);
    });
});

describe("services/roster/rosterTrials extendedTrialUntil", () => {
    it("adds 14 days to a future end and to today for a past one", () => {
        expect(TRIAL_EXTEND_DAYS).toBe(14);
        expect(extendedTrialUntil(iso(NOW + 2 * DAY), { now: NOW })).toBe(iso(NOW + 16 * DAY));
        expect(extendedTrialUntil(iso(NOW - 5 * DAY), { now: NOW })).toBe(iso(NOW + 14 * DAY));
        expect(extendedTrialUntil(null, { now: NOW })).toBe(iso(NOW + 14 * DAY));
    });
});
