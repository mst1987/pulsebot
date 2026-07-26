const { dayKey, candidatesForDay, bestDayMatch, formatDayDisplay } = require("../../src/web/lootEventMatch");

const secs = (ms) => Math.floor(ms / 1000);
// A Sunday raid, 20:00 Europe/Berlin (CEST, UTC+2) = 18:00 UTC.
const RAID_START = Date.UTC(2026, 6, 12, 18, 0, 0);
// Gargul's date-only export normalizes to UTC midnight of the same calendar day.
const GARGUL_AWARDED = Date.UTC(2026, 6, 12, 0, 0, 0);

const event = (over = {}) => ({ id: "e1", title: "SSC/TK", startTime: secs(RAID_START), categoryId: "cat1", ...over });

describe("web/lootEventMatch", () => {
    describe("dayKey", () => {
        it("formats a ms timestamp as yyyy-MM-dd in Europe/Berlin", () => {
            expect(dayKey(RAID_START)).toBe("2026-07-12");
        });

        it("returns \"\" for falsy input", () => {
            expect(dayKey(0)).toBe("");
            expect(dayKey(null)).toBe("");
        });
    });

    describe("candidatesForDay", () => {
        it("matches a Gargul date-only timestamp to the event on that day", () => {
            const cands = candidatesForDay(GARGUL_AWARDED, [event()]);
            expect(cands.map((e) => e.id)).toEqual(["e1"]);
        });

        it("ignores events on a different day", () => {
            const other = event({ id: "e2", startTime: secs(RAID_START) + 2 * 86400 });
            expect(candidatesForDay(GARGUL_AWARDED, [other])).toEqual([]);
        });

        it("returns every event sharing the day", () => {
            const other = event({ id: "e2", startTime: secs(RAID_START) - 3600 });
            expect(candidatesForDay(GARGUL_AWARDED, [event(), other]).map((e) => e.id)).toEqual(["e1", "e2"]);
        });

        it("tolerates a missing detected date and empty/invalid events", () => {
            expect(candidatesForDay(null, [event()])).toEqual([]);
            expect(candidatesForDay(GARGUL_AWARDED, [])).toEqual([]);
            expect(candidatesForDay(GARGUL_AWARDED, null)).toEqual([]);
            expect(candidatesForDay(GARGUL_AWARDED, [{ id: "x" }])).toEqual([]);
        });
    });

    describe("bestDayMatch", () => {
        it("returns the single event on that day as unambiguous", () => {
            const { match, ambiguous, candidates } = bestDayMatch(GARGUL_AWARDED, [event()]);
            expect(match.id).toBe("e1");
            expect(ambiguous).toBe(false);
            expect(candidates).toHaveLength(1);
        });

        it("reports no match and no ambiguity when nothing shares the day", () => {
            const res = bestDayMatch(GARGUL_AWARDED, [event({ startTime: secs(RAID_START) + 86400 })]);
            expect(res).toEqual({ match: null, candidates: [], ambiguous: false });
        });

        it("flags two events the same day as ambiguous instead of guessing", () => {
            const other = event({ id: "e2", startTime: secs(RAID_START) + 3600 });
            const { match, ambiguous, candidates } = bestDayMatch(GARGUL_AWARDED, [event(), other]);
            expect(match).toBeNull();
            expect(ambiguous).toBe(true);
            expect(candidates).toHaveLength(2);
        });
    });

    describe("formatDayDisplay", () => {
        it("formats as dd.MM.yyyy in Europe/Berlin", () => {
            expect(formatDayDisplay(RAID_START)).toBe("12.07.2026");
        });

        it("returns \"\" for falsy input", () => {
            expect(formatDayDisplay(0)).toBe("");
        });
    });
});
