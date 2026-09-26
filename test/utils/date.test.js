const {
    formatTimestampToDateString,
    formatGermanDateTime,
    toRaidHelperDate,
    parseGermanDate,
    parseClockTime,
} = require("../../src/utils/date.js");

describe("utils/date", () => {
    describe("formatTimestampToDateString", () => {
        it("formats a known timestamp in Europe/Paris", () => {
            // 2024-07-24T18:30:00Z == 20:30 CEST
            const formatted = formatTimestampToDateString(Date.UTC(2024, 6, 24, 18, 30));
            expect(formatted).toBe("24.07.2024 - 20:30");
        });
    });

    describe("formatGermanDateTime", () => {
        it("prints a moment like toLocaleString(\"de-DE\") in the server's zone", () => {
            // 2026-09-07T18:30:00Z == 20:30 CEST; winter time is one hour less
            expect(formatGermanDateTime(Date.UTC(2026, 8, 7, 18, 30))).toBe("7.9.2026, 20:30:00");
            expect(formatGermanDateTime(Date.UTC(2026, 0, 3, 6, 5, 3))).toBe("3.1.2026, 07:05:03");
            expect(formatGermanDateTime("2026-12-31T23:59:59Z")).toBe("1.1.2027, 00:59:59");
            expect(formatGermanDateTime(new Date(Date.UTC(2026, 8, 7, 18, 30)))).toBe("7.9.2026, 20:30:00");
            for (const t of [Date.UTC(2026, 3, 1, 9, 0), Date.UTC(2025, 9, 26, 0, 30)]) {
                expect(formatGermanDateTime(t)).toBe(new Date(t).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }));
            }
        });

        it("returns '' for something that is no moment", () => {
            expect(formatGermanDateTime("kein Datum")).toBe("");
            expect(formatGermanDateTime(undefined)).toBe("");
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

    describe("parseGermanDate", () => {
        // 16.09.2026, 12:00 Berlin
        const now = Date.UTC(2026, 8, 16, 10, 0);

        it("reads the ways people type a date", () => {
            expect(parseGermanDate("24.09.2026", now)).toBe("2026-09-24");
            expect(parseGermanDate("24.09.26", now)).toBe("2026-09-24");
            expect(parseGermanDate("24.09.", now)).toBe("2026-09-24");
            expect(parseGermanDate("24.9.", now)).toBe("2026-09-24");
            expect(parseGermanDate(" 2026-09-24 ", now)).toBe("2026-09-24");
        });

        it("refuses what is no calendar day", () => {
            for (const bad of ["", "31.09.", "24-09", "morgen", "24.13.2026", "2026-02-30", "24.09"]) {
                expect({ bad, parsed: parseGermanDate(bad, now) }).toEqual({ bad, parsed: "" });
            }
        });

        it("keeps a recent day without year in this year, so the caller sees it is past", () => {
            expect(parseGermanDate("15.09.", now)).toBe("2026-09-15");
        });

        it("moves a day long gone this year into the next one (January planned in December)", () => {
            const december = Date.UTC(2026, 11, 20, 12, 0);
            expect(parseGermanDate("08.01.", december)).toBe("2027-01-08");
            expect(parseGermanDate("08.01.2026", december)).toBe("2026-01-08");
        });
    });

    describe("parseClockTime", () => {
        it("reads 19:30, 19.30, 1930, 930, 19 and 19 Uhr", () => {
            expect(parseClockTime("19:30")).toBe("19:30");
            expect(parseClockTime("19.30")).toBe("19:30");
            expect(parseClockTime("1930")).toBe("19:30");
            expect(parseClockTime("930")).toBe("09:30");
            expect(parseClockTime("19")).toBe("19:00");
            expect(parseClockTime("19 Uhr")).toBe("19:00");
        });

        it("refuses impossible times", () => {
            for (const bad of ["", "24:00", "19:60", "abends", "19:3", "12345"]) {
                expect({ bad, parsed: parseClockTime(bad) }).toEqual({ bad, parsed: "" });
            }
        });
    });
});
