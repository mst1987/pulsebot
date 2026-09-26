// The duration rule of a raid (#305): clamped minutes and the planned end.
const {
    MIN_DURATION, MAX_DURATION, DEFAULT_DURATION, clampDuration, eventEndTime,
} = require("../../src/utils/eventTime");

describe("clampDuration", () => {
    it("keeps a duration within bounds and floors fractions", () => {
        expect(clampDuration(120)).toBe(120);
        expect(clampDuration("240")).toBe(240);
        expect(clampDuration(90.9)).toBe(90);
    });

    it("accepts the bounds themselves", () => {
        expect(clampDuration(MIN_DURATION)).toBe(30);
        expect(clampDuration(MAX_DURATION)).toBe(600);
    });

    it("falls back to the default for anything missing, odd or out of bounds", () => {
        expect(DEFAULT_DURATION).toBe(180);
        for (const raw of [undefined, null, "", "abc", NaN, Infinity, 29, 601, -5]) {
            expect(clampDuration(raw)).toBe(DEFAULT_DURATION);
        }
    });
});

describe("eventEndTime", () => {
    it("adds the duration in seconds to the start", () => {
        expect(eventEndTime({ startTime: 1000, durationMinutes: 60 })).toBe(1000 + 3600);
    });

    it("uses the default duration when the event has none", () => {
        expect(eventEndTime({ startTime: "2000" })).toBe(2000 + 180 * 60);
    });

    it("is 0 without a start", () => {
        expect(eventEndTime({ durationMinutes: 60 })).toBe(0);
        expect(eventEndTime(null)).toBe(0);
        expect(eventEndTime(undefined)).toBe(0);
        expect(eventEndTime({ startTime: "x" })).toBe(0);
    });
});
