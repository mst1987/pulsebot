// Request statistics for the "Systemstatus" page (docs/system-status.md).
//
// src/web/http/compression.js already times every /api, /r and /p request; it hands each finished one to record()
// here. This module keeps, per route pattern, how often it ran and how long it took - since the process started and
// for the last 60 minutes - plus the last slow requests. Nothing here knows HTTP; it only counts.
//
// A route pattern is the path with everything that looks like an id replaced by ":id" (normalizePath): the report
// /r/aBcD1234eFgH5678 and /r/zYx9... are one row, and no token or id is ever stored. The query string never reaches
// this module (compression.js passes the pathname only) and is cut off here again to be sure.
//
// Memory stays small and bounded: at most MAX_ROUTES rows (further patterns count as "other"), a reservoir of
// RESERVOIR durations per row for the p95 since start, the last RECENT_CAP durations per row for the p95 of the
// last hour, 60 minute buckets per row for exact counts, and SLOW_KEEP slow requests.

/** Different route patterns kept apart; beyond this they share the row "other" (a scan of random paths cannot grow memory). */
const MAX_ROUTES = 200;
/** Durations sampled per row for the p95 since start (reservoir sampling: every request has the same chance to be in it). */
const RESERVOIR = 256;
/** Durations kept per row for the p95 of the last hour. */
const RECENT_CAP = 300;
/** The window of the "last hour" figures. */
const WINDOW_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Slow requests kept, newest first. */
const SLOW_KEEP = 50;
const OTHER = "other";
/** SLOW_REQUEST_MS without a value in the environment. */
const DEFAULT_SLOW_MS = 1000;

/** SLOW_REQUEST_MS, read per call so it can be changed without a restart of the module; default 1000. */
function slowThresholdMs(env = process.env) {
    const raw = env.SLOW_REQUEST_MS;
    if (raw === undefined || raw === "") return DEFAULT_SLOW_MS;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SLOW_MS;
}

/** Whether one path segment is an id, a token or a number rather than a word of the route. */
function isIdSegment(seg) {
    if (!seg) return false;
    if (/^\d+$/.test(seg)) return true; // numbers, Discord snowflakes
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true; // uuid
    if (/^[0-9a-f]{8,}$/i.test(seg) && /\d/.test(seg)) return true; // hex ids, commit hashes
    // tokens and report codes: long, no word separators, letters and digits mixed
    if (seg.length >= 12 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg)) return true;
    // long opaque strings without a digit: only when upper and lower case mix (a route word is lower case)
    if (seg.length >= 24 && /^[A-Za-z0-9_.~-]+$/.test(seg) && /[A-Z]/.test(seg) && /[a-z]/.test(seg)) return true;
    return false;
}

/**
 * The route pattern of a request path: no query string, no trailing slash, every id-like segment as ":id".
 * "/r/aBcD1234eFgH5678/p/2?x=1" -> "/r/:id/p/:id".
 */
function normalizePath(pathname) {
    const bare = String(pathname || "").split(/[?#]/)[0] || "/";
    const segs = bare.split("/").map((s) => {
        let seg = s;
        try { seg = decodeURIComponent(s); } catch { /* a broken escape stays as it is */ }
        return isIdSegment(seg) ? ":id" : s;
    });
    const out = segs.join("/").replace(/\/+$/, "");
    return out || "/";
}

/** The p-th percentile (0-100) of a list of numbers, nearest-rank; 0 for an empty list. */
function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * A fresh statistics store. The module exports one (`record`, `snapshot`, `reset`) for compression.js and the
 * status route; tests build their own with a fake clock and random source.
 */
function createRequestStats({ now = Date.now, random = Math.random } = {}) {
    let rows = new Map();
    let slow = [];
    let since = now();

    function rowFor(route) {
        let row = rows.get(route);
        if (row) return row;
        if (rows.size >= MAX_ROUTES && route !== OTHER) return rowFor(OTHER);
        row = { route, count: 0, sum: 0, max: 0, slow: 0, reservoir: [], recent: [], minutes: [] };
        rows.set(route, row);
        return row;
    }

    /** One finished request. `slow` is the caller's verdict (SLOW_REQUEST_MS lives in compression.js). */
    function record(method, pathname, status, ms, isSlow = false) {
        const t = now();
        const route = normalizePath(pathname);
        const dur = Math.max(0, Number(ms) || 0);
        const row = rowFor(route);
        row.count += 1;
        row.sum += dur;
        if (dur > row.max) row.max = dur;
        if (isSlow) row.slow += 1;
        // reservoir sampling (algorithm R)
        if (row.reservoir.length < RESERVOIR) row.reservoir.push(dur);
        else {
            const j = Math.floor(random() * row.count);
            if (j < RESERVOIR) row.reservoir[j] = dur;
        }
        row.recent.push([t, dur]);
        if (row.recent.length > RECENT_CAP) row.recent.shift();
        const minute = Math.floor(t / MINUTE_MS);
        let bucket = row.minutes[row.minutes.length - 1];
        if (!bucket || bucket.minute !== minute) {
            bucket = { minute, count: 0, sum: 0, max: 0, slow: 0 };
            row.minutes.push(bucket);
            if (row.minutes.length > 60) row.minutes.shift();
        }
        bucket.count += 1;
        bucket.sum += dur;
        if (dur > bucket.max) bucket.max = dur;
        if (isSlow) {
            bucket.slow += 1;
            slow.unshift({ t, method: String(method || "GET"), path: route, status: Number(status) || 0, ms: Math.round(dur) });
            if (slow.length > SLOW_KEEP) slow.length = SLOW_KEEP;
        }
    }

    /** The figures of one row: since start and for the last hour. */
    function rowFigures(row, t) {
        const fromMinute = Math.floor((t - WINDOW_MS) / MINUTE_MS) + 1;
        const buckets = row.minutes.filter((b) => b.minute >= fromMinute);
        const hourCount = buckets.reduce((n, b) => n + b.count, 0);
        const hourSum = buckets.reduce((n, b) => n + b.sum, 0);
        const recent = row.recent.filter(([at]) => at > t - WINDOW_MS).map(([, d]) => d);
        return {
            route: row.route,
            total: {
                count: row.count,
                avg: row.count ? round1(row.sum / row.count) : 0,
                p95: round1(percentile(row.reservoir, 95)),
                max: round1(row.max),
                slow: row.slow,
            },
            hour: {
                count: hourCount,
                avg: hourCount ? round1(hourSum / hourCount) : 0,
                p95: round1(percentile(recent, 95)),
                max: round1(buckets.reduce((m, b) => Math.max(m, b.max), 0)),
                slow: buckets.reduce((n, b) => n + b.slow, 0),
            },
        };
    }

    /** Every row with its figures (busiest first) and the last slow requests. */
    function snapshot() {
        const t = now();
        const routes = [...rows.values()].map((row) => rowFigures(row, t))
            .sort((a, b) => b.total.count - a.total.count || a.route.localeCompare(b.route));
        return { since, routes, slow: slow.map((s) => ({ ...s })) };
    }

    function reset() {
        rows = new Map();
        slow = [];
        since = now();
    }

    return { record, snapshot, reset };
}

const shared = createRequestStats();

module.exports = {
    createRequestStats, normalizePath, isIdSegment, percentile, slowThresholdMs, DEFAULT_SLOW_MS,
    record: shared.record, snapshot: shared.snapshot, reset: shared.reset,
    MAX_ROUTES, RESERVOIR, RECENT_CAP, SLOW_KEEP, WINDOW_MS,
};
