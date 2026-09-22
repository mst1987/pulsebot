// The raid ID the lists group coming raids by: Wednesday (reset) to Tuesday,
// in Europe/Berlin. lib/raidId.ts is run as it is.
const { loadTs } = require("./i18nHelper");

const { raidIdOf, idsFromNow } = loadTs("lib/raidId.ts");

// Berlin wall-clock time -> epoch ms (September/October 2026: CEST, UTC+2).
const berlin = (iso) => Date.parse(`${iso}+02:00`);
const WED_23_09 = Date.UTC(2026, 8, 23);

describe("raidIdOf", () => {
    it("puts Wednesday to the following Tuesday into one ID", () => {
        for (const iso of ["2026-09-23T19:00", "2026-09-27T19:00", "2026-09-28T19:00", "2026-09-29T23:30"]) {
            expect(raidIdOf(berlin(iso))).toBe(WED_23_09);
        }
    });

    it("starts the next ID on Wednesday", () => {
        expect(raidIdOf(berlin("2026-09-30T19:00"))).toBe(WED_23_09 + 7 * 86400000);
        expect(raidIdOf(berlin("2026-09-22T19:00"))).toBe(WED_23_09 - 7 * 86400000);
    });

    it("keeps a raid past midnight before the reset in the old ID", () => {
        expect(raidIdOf(berlin("2026-09-30T00:30"))).toBe(WED_23_09);
        expect(raidIdOf(berlin("2026-09-30T06:00"))).toBe(WED_23_09 + 7 * 86400000);
    });

    it("takes the day in Berlin, not in UTC", () => {
        // Wednesday 05:30 Berlin is 03:30 UTC — after the reset hour only in Berlin
        expect(raidIdOf(berlin("2026-09-30T05:30"))).toBe(WED_23_09 + 7 * 86400000);
    });
});

describe("idsFromNow", () => {
    const now = berlin("2026-09-22T12:00"); // Tuesday: the ID of 16.09. still runs

    it("counts the running ID as 0 and the next from Wednesday on", () => {
        expect(idsFromNow(berlin("2026-09-22T19:00"), now)).toBe(0);
        expect(idsFromNow(berlin("2026-09-23T19:00"), now)).toBe(1);
        expect(idsFromNow(berlin("2026-09-29T19:00"), now)).toBe(1);
        expect(idsFromNow(berlin("2026-09-30T19:00"), now)).toBe(2);
        expect(idsFromNow(berlin("2026-09-15T19:00"), now)).toBe(-1);
    });
});
