// What a raid does once its size is reached (#306, #516), and how the signups
// are counted — one place for the event store, the raid templates, the signup
// rules and every counter (event message, public page, talk overview, bot
// overview, signups page, raid cockpit).
//
// `overflow` of an event / a raid template:
//   "none"     no limit (default since #516): every signup stays "Dabei"/"Spät",
//              the 25 are picked in the setup;
//   "waitlist" a new seat-taking signup on a full raid becomes the bench;
//   "refuse"   a new seat-taking signup on a full raid is refused (409 `full`).
//
// Before #516 the two limited modes were stored as "bench" and "off". Those
// values are *legacy*: the read path treats them as "none", and the start
// migration (settingsMigration.js) writes "none" over them once and switches
// `lockAtLimit` off on the same record. Because the new names differ, the
// migration can tell an untouched old record from a deliberate new choice and
// runs only once per record — no marker needed.
//
// The counters (#520) show one number: how many single Discord accounts are
// signed up — no "22/25", no "25/25 (+3)". With no limit by default a raid is
// never "full" in the counter's sense; the setup picks who plays.

const OVERFLOW_MODES = ["none", "waitlist", "refuse"];
const DEFAULT_OVERFLOW = "none";
const LEGACY_OVERFLOW = ["bench", "off"];
// Who counts as signed up: "Dabei" and "Spät" — the one status rule of every counter.
const ATTENDING_STATUSES = ["signed", "late"];

/** A stored or sent overflow value as one of OVERFLOW_MODES; anything else (legacy included) is "none". */
function normalizeOverflow(value) {
    return OVERFLOW_MODES.includes(value) ? value : DEFAULT_OVERFLOW;
}

/** Whether a stored overflow value is one from before #516 ("bench" / "off"). */
function isLegacyOverflow(value) {
    return LEGACY_OVERFLOW.includes(value);
}

/**
 * `lockAtLimit` as stored: a record still carrying a legacy overflow value reads
 * as "off" — the same answer the migration writes down.
 */
function normalizeLockAtLimit(record) {
    const src = record || {};
    return !isLegacyOverflow(src.overflow) && src.lockAtLimit === true;
}

/** A signup's status as the stores keep it: its `status`, "signed" when missing. */
function storedStatus(signup) {
    return String((signup && signup.status) || "signed");
}

/**
 * How many single Discord accounts are signed up (#520): status "Dabei" or
 * "Spät"; an account with several characters — one signup with alternates, or
 * several entries of the same user at Raid-Helper — counts once; a signup
 * without a user id counts as one of its own. Tentative, bench and absence do
 * not count. `statusOf` reads a signup's status (Raid-Helper entries need
 * attendance.signupStatus).
 */
function accountCount(signups, statusOf = storedStatus) {
    const seen = new Set();
    let anonymous = 0;
    for (const s of signups || []) {
        if (!s || !ATTENDING_STATUSES.includes(statusOf(s))) continue;
        const uid = String(s.userId || "");
        if (uid) seen.add(uid);
        else anonymous += 1;
    }
    return seen.size + anonymous;
}

/** The counter as a raider reads it in Discord: "28 signed up". */
function signedUpText(accounts) {
    return `${Math.max(0, Number(accounts) || 0)} signed up`;
}

module.exports = {
    OVERFLOW_MODES, DEFAULT_OVERFLOW, ATTENDING_STATUSES, normalizeOverflow, isLegacyOverflow, normalizeLockAtLimit,
    accountCount, signedUpText,
};
