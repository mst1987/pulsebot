// The raid ID on the backend (utils/time/raidId.js) and its twin in the web client
// (src/web-client/src/lib/raids/raidId.ts): the same constants, the same answers.
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const { raidIdOf, idsFromNow, idDistance, raidIdRange, RESET_HOUR, DAY_MS } = require("../../../src/utils/time/raidId");
const { TIMEZONE } = require("../../../src/config/timezone");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "lib");
const TWIN = fs.readFileSync(path.join(CLIENT, "raids", "raidId.ts"), "utf8");
const FORMAT = fs.readFileSync(path.join(CLIENT, "format.ts"), "utf8");

/** The client's functions, run as they are: the TypeScript stripped to JavaScript. */
function clientTwin() {
    const source = TWIN
        .replace(/^import .*$/m, "")
        .replace(/export function/g, "function")
        .replace(/\(ms: number, now: number\): number/g, "(ms, now)")
        .replace(/\(ms: number\): number/g, "(ms)")
        .replace(/\(day: number\): number/g, "(day)");
    return new Function("isoDay", `${source}\nreturn { raidIdOf, idsFromNow };`)(
        (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TIMEZONE }),
    );
}

/** A wall-clock time in server time as a Date. */
const berlin = (iso) => DateTime.fromISO(iso, { zone: TIMEZONE }).toJSDate();
const wed = (y, m, d) => Date.UTC(y, m - 1, d);

describe("utils/time/raidId", () => {
    it("keeps the constants of the client twin", () => {
        expect(TWIN).toContain(`const RESET_HOUR = ${RESET_HOUR};`);
        expect(TWIN).toContain(`const DAY_MS = ${DAY_MS};`);
        expect(TWIN).toContain("(new Date(day).getUTCDay() + 4) % 7");
        expect(FORMAT).toContain(`export const DISPLAY_TZ = "${TIMEZONE}";`);
    });

    it("answers like the client twin over a stretch of two years, DST changes included", () => {
        const client = clientTwin();
        const start = Date.UTC(2026, 0, 1);
        for (let ms = start; ms < start + 2 * 365 * DAY_MS; ms += 47 * 60000) {
            expect(raidIdOf(ms)).toBe(client.raidIdOf(ms));
        }
        expect(idsFromNow(Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 12))).toBe(client.idsFromNow(Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 12)));
    });

    describe("raidIdOf", () => {
        it("puts Wednesday morning to Tuesday into one ID (its Wednesday)", () => {
            // 14 Oct 2026 is a Wednesday
            expect(raidIdOf(berlin("2026-10-14T06:00:00").getTime())).toBe(wed(2026, 10, 14));
            expect(raidIdOf(berlin("2026-10-17T20:00:00").getTime())).toBe(wed(2026, 10, 14));
            expect(raidIdOf(berlin("2026-10-20T20:00:00").getTime())).toBe(wed(2026, 10, 14));
        });

        it("lets Tuesday 23:30 and Wednesday 03:00 still belong to the ID before the reset", () => {
            expect(raidIdOf(berlin("2026-10-20T23:30:00").getTime())).toBe(wed(2026, 10, 14));
            expect(raidIdOf(berlin("2026-10-21T03:00:00").getTime())).toBe(wed(2026, 10, 14));
            expect(raidIdOf(berlin("2026-10-21T04:59:00").getTime())).toBe(wed(2026, 10, 14));
        });

        it("starts the next ID at Wednesday 05:00 server time", () => {
            expect(raidIdOf(berlin("2026-10-21T05:00:00").getTime())).toBe(wed(2026, 10, 21));
            expect(raidIdOf(berlin("2026-10-21T06:00:00").getTime())).toBe(wed(2026, 10, 21));
        });

        it("holds across the DST change of late October (Sunday 25 Oct 2026, 03:00 to 02:00)", () => {
            expect(raidIdOf(berlin("2026-10-24T20:00:00").getTime())).toBe(wed(2026, 10, 21));
            expect(raidIdOf(berlin("2026-10-25T20:00:00").getTime())).toBe(wed(2026, 10, 21));
            expect(raidIdOf(berlin("2026-10-27T23:30:00").getTime())).toBe(wed(2026, 10, 21));
            expect(raidIdOf(berlin("2026-10-28T04:59:00").getTime())).toBe(wed(2026, 10, 21));
            expect(raidIdOf(berlin("2026-10-28T05:00:00").getTime())).toBe(wed(2026, 10, 28));
        });
    });

    it("counts IDs from now", () => {
        const now = berlin("2026-10-14T20:00:00").getTime();
        expect(idsFromNow(berlin("2026-10-20T23:30:00").getTime(), now)).toBe(0);
        expect(idsFromNow(berlin("2026-10-21T06:00:00").getTime(), now)).toBe(1);
        expect(idsFromNow(berlin("2026-10-28T06:00:00").getTime(), now)).toBe(2);
        expect(idsFromNow(berlin("2026-10-13T20:00:00").getTime(), now)).toBe(-1);
    });

    it("counts IDs from the Wednesday of an ID", () => {
        const now = berlin("2026-10-14T20:00:00").getTime();
        expect(idDistance(wed(2026, 10, 14), now)).toBe(0);
        expect(idDistance(wed(2026, 10, 21), now)).toBe(1);
        expect(idDistance(wed(2026, 10, 7), now)).toBe(-1);
    });

    it("gives the Wednesday and the Tuesday of an ID", () => {
        expect(raidIdRange(wed(2026, 10, 14))).toEqual({ from: wed(2026, 10, 14), to: wed(2026, 10, 20) });
    });
});
