// The raid ID - the lockout week from the Wednesday reset to the Tuesday after
// it - in the server time zone. The backend twin of
// src/web-client/src/lib/raids/raidId.ts (the web groups raids the same way);
// test/utils/time/raidId.test.js keeps the constants and the logic in step.
//
// An ID is the UTC-midnight timestamp of its Wednesday. A raid on Tuesday 23:30
// or Wednesday 03:00 (before the reset) still belongs to the ID before.
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");

const DAY_MS = 86400000;
/** The EU weekly reset is early on Wednesday: a time before this hour belongs to the day before. */
const RESET_HOUR = 5;

/** The raid ID an epoch-ms time falls in: its Wednesday as a UTC-midnight timestamp. */
function raidIdOf(ms) {
    const local = DateTime.fromMillis(Number(ms) - RESET_HOUR * 3600000, { zone: TIMEZONE });
    const day = Date.UTC(local.year, local.month - 1, local.day);
    const sinceReset = (new Date(day).getUTCDay() + 4) % 7; // 0 = Wednesday ... 6 = Tuesday
    return day - sinceReset * DAY_MS;
}

/** How many IDs `ms` lies after the ID of `now` (0 = the running one, negative = past). */
function idsFromNow(ms, now) {
    return Math.round((raidIdOf(ms) - raidIdOf(now)) / (7 * DAY_MS));
}

/** How many IDs the ID `id` (a Wednesday, as raidIdOf returns it) lies after the ID of `now`. */
function idDistance(id, now) {
    return Math.round((Number(id) - raidIdOf(now)) / (7 * DAY_MS));
}

/** First (Wednesday) and last (Tuesday) day of an ID as UTC-midnight timestamps. */
function raidIdRange(id) {
    return { from: id, to: id + 6 * DAY_MS };
}

module.exports = { DAY_MS, RESET_HOUR, raidIdOf, idsFromNow, idDistance, raidIdRange };
