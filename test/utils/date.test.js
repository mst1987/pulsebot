const {
    getWednesdayWeeksAgo,
    parseDMYDateString,
    toTimestamp,
    formatTimestampToDateString,
    toRaidHelperDate,
} = require("../../src/utils/date.js");

describe("utils/date", () => {
    describe("parseDMYDateString", () => {
        it("parses a D-M-YYYY string into a Date", () => {
            const date = parseDMYDateString("5-3-2024");
            expect(date.getFullYear()).toBe(2024);
            expect(date.getMonth()).toBe(2); // March, zero-based
            expect(date.getDate()).toBe(5);
        });

        it("handles two-digit day and month", () => {
            const date = parseDMYDateString("25-12-2023");
            expect(date.getMonth()).toBe(11);
            expect(date.getDate()).toBe(25);
        });
    });

    describe("getWednesdayWeeksAgo", () => {
        it("always returns a Wednesday", () => {
            for (let weeks = 1; weeks <= 6; weeks++) {
                expect(getWednesdayWeeksAgo(weeks).getDay()).toBe(3);
            }
        });

        it("returns an earlier date for more weeks ago", () => {
            const oneWeek = getWednesdayWeeksAgo(1).getTime();
            const threeWeeks = getWednesdayWeeksAgo(3).getTime();
            expect(threeWeeks).toBeLessThan(oneWeek);
        });
    });

    describe("toTimestamp / formatTimestampToDateString", () => {
        it("round-trips a CET date string to millis and back", () => {
            const millis = toTimestamp("24.07.24-20:30");
            expect(typeof millis).toBe("number");
            const formatted = formatTimestampToDateString(millis);
            expect(formatted).toBe("24.07.2024 - 20:30");
        });

        it("formats a known timestamp in Europe/Paris", () => {
            // 2024-07-24T18:30:00Z == 20:30 CEST
            const formatted = formatTimestampToDateString(Date.UTC(2024, 6, 24, 18, 30));
            expect(formatted).toBe("24.07.2024 - 20:30");
        });
    });

    describe("toRaidHelperDate", () => {
        it("converts an ISO date (from <input type=date>) to dd-MM-yyyy", () => {
            expect(toRaidHelperDate("2026-07-24")).toBe("24-07-2026");
        });

        it("passes an already dd-MM-yyyy value through unchanged", () => {
            expect(toRaidHelperDate("24-07-2026")).toBe("24-07-2026");
        });

        it("returns '' for empty or unrecognised input", () => {
            expect(toRaidHelperDate("")).toBe("");
            expect(toRaidHelperDate(null)).toBe("");
            expect(toRaidHelperDate("not-a-date")).toBe("");
            expect(toRaidHelperDate("2026/07/24")).toBe("");
        });
    });
});
