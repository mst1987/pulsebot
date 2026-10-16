import { describe, expect, it } from "vitest";
import { DEFAULT_FROM, fromMinutes, stepTime, toMinutes, withDayTime } from "./dayTimes";

describe("dayTimes", () => {
    it("reads and writes HH:MM", () => {
        expect(toMinutes("19:30")).toBe(1170);
        expect(toMinutes("")).toBeNull();
        expect(fromMinutes(1170)).toBe("19:30");
        expect(fromMinutes(5)).toBe("00:05");
    });

    it("steps in quarter hours, starts a day without an hour at the default, stops at the ends", () => {
        expect(stepTime("", 1)).toBe(DEFAULT_FROM);
        expect(stepTime(undefined, -1)).toBeNull();
        expect(stepTime("19:00", 1)).toBe("19:15");
        expect(stepTime("19:00", -1)).toBe("18:45");
        expect(stepTime("23:45", 1)).toBeNull();
        expect(stepTime("00:00", -1)).toBeNull();
    });

    it("sets and clears one day's hour", () => {
        expect(withDayTime({ mo: "19:00" }, "mi", "20:00")).toEqual({ mo: "19:00", mi: "20:00" });
        expect(withDayTime({ mo: "19:00" }, "mo", "")).toEqual({});
    });
});
