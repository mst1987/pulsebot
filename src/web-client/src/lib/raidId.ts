// The raid ID — the lockout week from the Wednesday reset to the Tuesday after
// it — in the guild's time zone, so a raid on Tuesday 23:30 does not slip into
// the next ID for a viewer elsewhere. Written without typed consts, so the
// tests run it as it is (test/web-client/raidId.test.js).

const TZ = "Europe/Berlin";
const DAY_MS = 86400000;
/**
 * The EU weekly reset is early on Wednesday morning: a raid that starts after
 * midnight but before this hour still belongs to the ID before it, so a time
 * is moved back by this much before its day is taken.
 */
const RESET_HOUR = 5;

/** The calendar day (UTC midnight of that date) an epoch-ms time falls on in TZ. */
function dayOf(ms: number): number {
    return Date.parse(new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }));
}

/** Wednesday of the raid ID the day lies in, as a UTC-midnight timestamp. */
function resetDayOf(day: number): number {
    const sinceReset = (new Date(day).getUTCDay() + 4) % 7; // 0 = Wednesday … 6 = Tuesday
    return day - sinceReset * DAY_MS;
}

/** The raid ID an epoch-ms time falls in — its Wednesday, as a UTC-midnight timestamp. */
export function raidIdOf(ms: number): number {
    return resetDayOf(dayOf(ms - RESET_HOUR * 3600000));
}

/** How many IDs `ms` lies after the ID of `now` (0 = the running one, negative = past). */
export function idsFromNow(ms: number, now: number): number {
    return Math.round((raidIdOf(ms) - raidIdOf(now)) / (7 * DAY_MS));
}
