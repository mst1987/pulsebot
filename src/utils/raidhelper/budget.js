const { AsyncLocalStorage } = require("async_hooks");
const { readBudget, writeBudget } = require("../../stores/raidhelperBudgetStore");
const { RAIDHELPER_BUDGET } = require("../../config/constants");
const { TIMEZONE } = require("../../config/timezone");

// The request budget for raid-helper.xyz.
//
// Raid-Helper allows 1000 requests per API key in a rolling 24 hours. Past
// that it answers HTTP 429 ("Rate limit encountered: 1000 / 24h") to every
// request — the event list, a raidplan, a signup — until the window has rolled
// on, and the web admin shows "Events konnten nicht geladen werden". This
// module keeps the bot below the limit instead of finding it:
//
//   - classes/raidhelper.js asks check() before every request and record()s
//     every attempt that actually leaves (a retry counts too). The count lives
//     in stores/raidhelperBudgetStore.js, hour by hour, so a restart keeps it.
//   - Each request has a priority with its own cap (config/constants.js
//     RAIDHELPER_BUDGET): `background` (the jobs of web/http/jobs.js) stops
//     first, `read` (page loads, bot commands) next, `write` (create an event,
//     sign up) last. A refused request throws an Error with code
//     "raidhelper_budget" and a German message; every reader already falls back
//     to its cache or the stored snapshots, exactly as during an outage.
//   - A 429 that still comes back (another instance on the same key) pauses
//     every request until the time Raid-Helper names, plus an hour.
//   - Outside production (a local test instance shares the key with the live
//     bot) all priorities share the small `dev` budget and background jobs ask
//     nothing at all unless RAIDHELPER_BACKGROUND=1.
//
// Which priority a request has: a method other than GET is a write; otherwise
// it is background when it runs inside runInBackground() — jobs.js starts every
// job there, and the async context carries over to its timers — else a read.

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;
const CODE = "raidhelper_budget";

const context = new AsyncLocalStorage();

/** Run `fn` (and every timer and promise it starts) as background work. */
function runInBackground(fn) {
    return context.run({ background: true }, fn);
}

/** Whether the current code runs inside runInBackground(). */
function isBackground() {
    const store = context.getStore();
    return !!(store && store.background);
}

/** "write" for anything but GET, else "background" or "read" by the async context. */
function priorityFor(method) {
    if (String(method || "get").toLowerCase() !== "get") return "write";
    return isBackground() ? "background" : "read";
}

const isProduction = (env) => (env || process.env).NODE_ENV === "production";

/** The number of requests a priority may reach in 24 hours. */
function capFor(priority, env = process.env) {
    const cap = RAIDHELPER_BUDGET[priority] === undefined ? RAIDHELPER_BUDGET.read : RAIDHELPER_BUDGET[priority];
    if (isProduction(env)) return cap;
    if (priority === "background" && env.RAIDHELPER_BACKGROUND !== "1") return 0;
    return Math.min(cap, RAIDHELPER_BUDGET.dev);
}

const hourOf = (ms) => Math.floor(ms / HOUR_MS);

// Only the hours still inside the window; an hour drops out 24 h after it began.
function liveHours(hours, now) {
    const oldest = hourOf(now) - WINDOW_HOURS + 1;
    const out = {};
    for (const [hour, count] of Object.entries(hours || {})) {
        if (Number(hour) >= oldest) out[hour] = count;
    }
    return out;
}

const sum = (hours) => Object.values(hours).reduce((a, n) => a + n, 0);

// When the count falls below `cap` again, as the oldest hours drop out.
function freeAt(hours, cap, now) {
    let remaining = sum(hours);
    if (remaining < cap) return now;
    for (const hour of Object.keys(hours).map(Number).sort((a, b) => a - b)) {
        remaining -= hours[hour];
        if (remaining < cap) return (hour + WINDOW_HOURS) * HOUR_MS;
    }
    return now + WINDOW_HOURS * HOUR_MS;
}

function clock(ms) {
    return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
}

function refusal(message) {
    const e = new Error(message);
    e.code = CODE;
    return e;
}

/**
 * Throws (code "raidhelper_budget") when a request of this priority may not go
 * out now; returns nothing otherwise.
 */
function check(priority, { now = Date.now(), env = process.env } = {}) {
    const state = readBudget();
    if (state.blockedUntil > now) {
        const why = state.blockedReason ? ` (${state.blockedReason})` : "";
        throw refusal(`Raid-Helper hat sein Tageslimit gemeldet${why} – keine Abfragen bis ca. ${clock(state.blockedUntil)} Uhr.`);
    }
    const cap = capFor(priority, env);
    if (cap === 0) {
        throw refusal("Hintergrundabfragen an Raid-Helper sind auf Testinstanzen aus (RAIDHELPER_BACKGROUND=1 schaltet sie ein).");
    }
    const hours = liveHours(state.hours, now);
    const used = sum(hours);
    if (used < cap) return;
    const what = priority === "background" ? "Hintergrundabfragen pausieren" : "neue Abfragen erst wieder";
    throw refusal(`Raid-Helper-Kontingent geschont: ${used} von ${RAIDHELPER_BUDGET.limit} Anfragen in 24 h verbraucht – ${what} ab ca. ${clock(freeAt(hours, cap, now))} Uhr.`);
}

/** Count one request that is about to leave. */
function record({ now = Date.now() } = {}) {
    const state = readBudget();
    const hours = liveHours(state.hours, now);
    const hour = String(hourOf(now));
    hours[hour] = (hours[hour] || 0) + 1;
    writeBudget({ ...state, hours });
}

/**
 * Raid-Helper answered 429: no request until the time it names ("Try again in
 * N hour(s)") plus an hour, since it rounds down — "0 hour(s)" means "within
 * the hour", not "now".
 */
function noteRateLimited(body, { now = Date.now() } = {}) {
    let reason;
    try {
        const parsed = typeof body === "string" ? JSON.parse(body) : body;
        reason = String((parsed && (parsed.reason || parsed.message)) || "");
    } catch {
        reason = String(body || "");
    }
    const match = /in\s+(\d+)\s*hour/i.exec(reason);
    const hours = match ? Number(match[1]) : 0;
    const state = readBudget();
    writeBudget({
        ...state,
        hours: liveHours(state.hours, now),
        blockedUntil: Math.max(state.blockedUntil, now + (hours + 1) * HOUR_MS),
        blockedReason: reason.slice(0, 200),
    });
}

/** What the budget looks like right now (for /health and the settings page). */
function status({ now = Date.now(), env = process.env } = {}) {
    const state = readBudget();
    const used = sum(liveHours(state.hours, now));
    return {
        used,
        limit: RAIDHELPER_BUDGET.limit,
        caps: { background: capFor("background", env), read: capFor("read", env), write: capFor("write", env) },
        blockedUntil: state.blockedUntil > now ? state.blockedUntil : 0,
    };
}

/** Whether `error` is one of this module's refusals. */
const isBudgetError = (error) => !!(error && error.code === CODE);

module.exports = {
    runInBackground, isBackground, priorityFor, capFor, check, record, noteRateLimited, status, isBudgetError,
    BUDGET_CODE: CODE,
};
