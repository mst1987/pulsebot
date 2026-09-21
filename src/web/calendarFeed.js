// The raider's calendar subscription (#312): `GET /r/cal/user/<token>.ics`.
//
// What the route has to get right, and why it is here rather than in the route:
//
//   · **The token is the whole authentication.** `feedFor()` verifies it against
//     calendarTokenStore before reading anything at all, and answers `null` for
//     an unknown *or* revoked one — the route turns that into a plain 404, the
//     same answer a token that never existed gets. Nothing in the response ever
//     says which of the two it was.
//   · **Only what that raider may see.** The feed is built from their own
//     signups (`signupStore.signupsOfUser`) and the events those point at;
//     `icsFeed.vevent()` writes the raid and the reader's own status, nothing
//     about anyone else. A leaked link therefore gives away exactly one thing:
//     that this person is signed up for these raids.
//   · **No load.** A subscribed calendar polls on its own schedule, several
//     clients per raider, forever. The built file is cached per token for five
//     minutes and the window is bounded (30 days back, 90 days forward, at most
//     MAX_EVENTS entries) — a raider with three years of raids behind them does
//     not hand a calendar client a three-year file.
//
// Only **own** events appear: a Raid-Helper event has no signup in our store,
// and its id is not in eventStore either.
const { listEvents } = require("./eventStore");
const { signupsOfUser } = require("./signupStore");
const { verifyToken, touchToken } = require("./calendarTokenStore");
const { buildUserCalendar } = require("./icsFeed");

const DAY = 86400;
// Far enough back that last week's raid is still in the calendar, short enough
// that a year-old absence does not sit there forever.
const BACK_DAYS = 30;
// Raids are planned weeks ahead, not years; anything further out is not planned
// yet. A client re-fetches long before a raid moves into the window.
const FORWARD_DAYS = 90;
const MAX_EVENTS = 200;
const CACHE_MS = 5 * 60 * 1000;
// A cap so a flood of tokens cannot grow the map without bound.
const MAX_CACHE = 500;
const CALENDAR_NAME = "My raids";

const cache = new Map();

/** Tests (and a config change) start from an empty cache. */
function clearCache() {
    cache.clear();
}

/**
 * The raids one raider is signed up for, inside the window, soonest first.
 * Pure over the stores; `null` is never returned — a raider without signups
 * gets an empty list, which is a valid (empty) calendar.
 * @returns {{ event: object, status: string, changedAt: number }[]}
 */
function collectEntries(userId, { now = Date.now() } = {}) {
    const mine = signupsOfUser(userId);
    const ids = Object.keys(mine);
    if (!ids.length) return [];
    const seconds = Math.floor(now / 1000);
    const events = listEvents("", {
        sinceSeconds: seconds - BACK_DAYS * DAY,
        untilSeconds: seconds + FORWARD_DAYS * DAY,
    });
    const entries = [];
    for (const event of events) {
        const signup = mine[event.id];
        if (!signup || !event.startTime) continue;
        entries.push({
            event,
            status: String(signup.status || "signed"),
            // A status change must bump the VEVENT's SEQUENCE, or a calendar
            // client is entitled to ignore the update it just fetched.
            changedAt: Number(signup.updatedAt) || Number(signup.at) || 0,
        });
    }
    entries.sort((a, b) => (a.event.startTime || 0) - (b.event.startTime || 0));
    return entries.slice(0, MAX_EVENTS);
}

/**
 * The calendar behind a subscription token.
 * @param {string} rawToken the token out of the url
 * @param {{ now?: number }} [opts]
 * @returns {{ body: string, cached: boolean, id: string }|null} null = unknown or revoked
 */
function feedFor(rawToken, { now = Date.now() } = {}) {
    const record = verifyToken(rawToken);
    if (!record || !record.userId) return null;
    const hit = cache.get(record.id);
    if (hit && now - hit.at < CACHE_MS) return { body: hit.body, cached: true, id: record.id };
    const body = buildUserCalendar(collectEntries(record.userId, { now }), { name: CALENDAR_NAME, now });
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(record.id, { at: now, body });
    // Only on a miss, so a polling client writes to disk at most once per
    // cache window and the profile can still say "noch nie abgerufen".
    touchToken(record.id);
    return { body, cached: false, id: record.id };
}

module.exports = {
    feedFor, collectEntries, clearCache,
    BACK_DAYS, FORWARD_DAYS, MAX_EVENTS, CACHE_MS, CALENDAR_NAME,
};
