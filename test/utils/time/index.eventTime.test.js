// The duration rule of a raid (#305): an optional duration, the planned end,
// and the default end only for the places that must have one.
const {
    MIN_DURATION, MAX_DURATION, DEFAULT_DURATION, durationOf, eventEndTime, plannedEndOrDefault,
} = require("../../../src/utils/time");

describe("durationOf", () => {
    it("keeps a duration within bounds and floors fractions", () => {
        expect(durationOf(120)).toBe(120);
        expect(durationOf("240")).toBe(240);
        expect(durationOf(90.9)).toBe(90);
    });

    it("accepts the bounds themselves", () => {
        expect(durationOf(MIN_DURATION)).toBe(30);
        expect(durationOf(MAX_DURATION)).toBe(600);
    });

    it("reads anything missing, odd or out of bounds as not set (null), never as a default", () => {
        for (const raw of [undefined, null, "", "abc", NaN, Infinity, 0, 29, 601, -5]) {
            expect({ raw, d: durationOf(raw) }).toEqual({ raw, d: null });
        }
    });
});

describe("eventEndTime", () => {
    it("adds the duration in seconds to the start", () => {
        expect(eventEndTime({ startTime: 1000, durationMinutes: 60 })).toBe(1000 + 3600);
    });

    it("is 0 — no planned end — when the event has no duration", () => {
        expect(eventEndTime({ startTime: "2000" })).toBe(0);
        expect(eventEndTime({ startTime: 2000, durationMinutes: null })).toBe(0);
        expect(eventEndTime({ startTime: 2000, durationMinutes: 5 })).toBe(0);
    });

    it("is 0 without a start", () => {
        expect(eventEndTime({ durationMinutes: 60 })).toBe(0);
        expect(eventEndTime(null)).toBe(0);
        expect(eventEndTime(undefined)).toBe(0);
        expect(eventEndTime({ startTime: "x" })).toBe(0);
    });
});

describe("plannedEndOrDefault", () => {
    it("is the planned end when there is one", () => {
        expect(plannedEndOrDefault({ startTime: 1000, durationMinutes: 60 })).toBe(1000 + 3600);
    });

    it("falls back to start + the default duration without one", () => {
        expect(DEFAULT_DURATION).toBe(180);
        expect(plannedEndOrDefault({ startTime: 2000 })).toBe(2000 + 180 * 60);
        expect(plannedEndOrDefault({ startTime: "2000", durationMinutes: null })).toBe(2000 + 180 * 60);
    });

    it("is 0 without a start", () => {
        expect(plannedEndOrDefault({ durationMinutes: 60 })).toBe(0);
        expect(plannedEndOrDefault(null)).toBe(0);
    });
});
