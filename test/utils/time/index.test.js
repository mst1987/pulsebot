const {
    formatTimestampToDateString,
    formatGermanDateTime,
    toRaidHelperDate,
    parseGermanDate,
    parseDayRange,
    parseClockTime,
} = require("../../../src/utils/time");

describe("utils/time: German dates", () => {
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

        it("reads what raiders type in a hurry: no closing dot, spaces, slashes, dashes, month names, today/tomorrow", () => {
            for (const typed of ["24.09", "24. 09.", "24 .9", "24/9", "24-09", "24-09-2026", "24.09.2026.", "24. Sept", "24 September",
                "24 Sep 2026", "Sep 24", "September 24th, 2026", "24.9.26"]) {
                expect({ typed, parsed: parseGermanDate(typed, now) }).toEqual({ typed, parsed: "2026-09-24" });
            }
            expect(parseGermanDate("3. Okt", now)).toBe("2026-10-03");
            expect(parseGermanDate("heute", now)).toBe("2026-09-16");
            expect(parseGermanDate("Morgen", now)).toBe("2026-09-17");
            expect(parseGermanDate("tomorrow", now)).toBe("2026-09-17");
            // the American way only where the order is clear
            expect(parseGermanDate("9/24", now)).toBe("2026-09-24");
            expect(parseGermanDate("05/06", now)).toBe("2027-06-05");
        });

        it("refuses what is no calendar day", () => {
            for (const bad of ["", "31.09.", "irgendwann", "24.13.2026", "2026-02-30", "13.13.", "24 Foo", "32.1."]) {
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

    describe("parseDayRange", () => {
        const now = Date.UTC(2026, 8, 16, 10, 0);

        it("reads a whole period in one field, and a single day as a period of one", () => {
            for (const typed of ["24.09.-30.09.", "24.09. - 30.09.", "24.9 bis 30.9", "24 Sep to 30 Sep", "24.09.–30.09.", "24-09-2026 - 30-09-2026"]) {
                expect({ typed, range: parseDayRange(typed, now) }).toEqual({ typed, range: { from: "2026-09-24", to: "2026-09-30" } });
            }
            expect(parseDayRange("24.09.", now)).toEqual({ from: "2026-09-24", to: "2026-09-24" });
        });

        it("puts an end before the start into the next year (Christmas holidays), unless a year was typed", () => {
            expect(parseDayRange("28.12.-3.1.", now)).toEqual({ from: "2026-12-28", to: "2027-01-03" });
            expect(parseDayRange("28.12.2026-3.1.2026", now)).toEqual({ from: "2026-12-28", to: "2026-01-03" });
        });

        it("is null for what is no date at all", () => {
            expect(parseDayRange("", now)).toBeNull();
            expect(parseDayRange("nächste Woche", now)).toBeNull();
            expect(parseDayRange("24.09.-irgendwann", now)).toBeNull();
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
