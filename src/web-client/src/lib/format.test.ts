// The date formatters every page shares (#440): always the guild's time zone,
// the menu's language decides the wording.
import { afterAll, describe, expect, it } from "vitest";
import { DISPLAY_TZ, formatDateTime, formatDayDate, formatDayMonth, formatMoney, formatTime, formatWeekday, formatWith, isoDay } from "./format";
import { inLang, switchLang } from "../test/i18n";

// Thursday 17.09.2026 19:30 in Berlin (CEST, UTC+2)
const AT = Date.UTC(2026, 8, 17, 17, 30);

describe("lib/format", () => {
    afterAll(() => switchLang("de"));

    it("shows every time in Berlin", () => {
        expect(DISPLAY_TZ).toBe("Europe/Berlin");
        expect(formatTime(AT)).toBe("19:30");
        // 23:30 UTC is already the next day in Berlin
        expect(isoDay(Date.UTC(2026, 8, 17, 23, 30))).toBe("2026-09-18");
    });

    it("writes German dates by default", () => {
        expect(formatDayMonth(AT)).toBe("17.09.");
        expect(formatWeekday(AT)).toBe("Do");
        expect(formatDayDate(AT)).toBe("Do 17.09.");
        expect(formatDateTime(AT)).toBe("Do 17.09. 19:30");
        expect(formatWith(AT, { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("17.09.2026");
    });

    it("writes British dates in English", async () => {
        await inLang("en", () => {
            expect(formatDayMonth(AT)).toBe("17/09");
            expect(formatDayDate(AT)).toBe("Thu 17/09");
            expect(formatDateTime(AT)).toBe("Thu 17/09 19:30");
        });
    });

    it("leaves an empty time empty", () => {
        expect(formatTime(0)).toBe("");
        expect(formatDayDate(0)).toBe("");
        expect(formatDateTime(0)).toBe("");
    });

    it("writes WoW money from copper, zero parts left out, thousands in the menu's language", async () => {
        expect(formatMoney(48123405)).toBe("4.812 g 34 s 5 c");
        expect(formatMoney(48120000)).toBe("4.812 g");
        expect(formatMoney(150)).toBe("1 s 50 c");
        expect(formatMoney(0)).toBe("0 c");
        expect(formatMoney(-5)).toBe("0 c");
        expect(await inLang("en", () => formatMoney(48120000))).toBe("4,812 g");
    });
});
