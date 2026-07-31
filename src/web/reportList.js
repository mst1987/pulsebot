// Pure sorting + pagination for the CLA lists (report evaluations AND detected
// logs). Kept framework-free and side-effect-free so it is trivially
// unit-testable; the server route feeds it the list plus the ?sort/?dir/?page
// query params.

const DEFAULT_PAGE_SIZE = 15;

function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Generic sort + paginate.
 * @param {object[]} items
 * @param {object} query   { sort, dir, page } (raw query-string values)
 * @param {object} cfg     { sortKeys, defaultSort, pageSize?, tiebreak? }
 *   sortKeys: { key -> (item) => comparable }; tiebreak: (a,b) => number applied
 *   when the primary comparison is equal (direction-independent).
 * @returns {{ items, sort, dir, page, totalPages, total, pageSize }}
 */
function sortAndPaginate(items, query = {}, cfg = {}) {
    const sortKeys = cfg.sortKeys || {};
    const pageSize = cfg.pageSize > 0 ? cfg.pageSize : DEFAULT_PAGE_SIZE;
    const list = Array.isArray(items) ? items : [];

    const sort = sortKeys[query.sort] ? query.sort : cfg.defaultSort;
    const dir = query.dir === "asc" ? "asc" : "desc";
    const keyFn = sortKeys[sort] || (() => 0);
    const tiebreak = cfg.tiebreak || (() => 0);

    const sorted = list.slice().sort((a, b) => {
        const av = keyFn(a);
        const bv = keyFn(b);
        let cmp;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        cmp = dir === "asc" ? cmp : -cmp;
        if (cmp !== 0) return cmp;
        return tiebreak(a, b);
    });

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, toInt(query.page, 1)), totalPages);
    const start = (page - 1) * pageSize;
    const pageItems = sorted.slice(start, start + pageSize);

    return { items: pageItems, sort, dir, page, totalPages, total, pageSize };
}

// ---- report evaluations ----
const REPORT_SORT_KEYS = {
    date: (r) => r.generatedAt || 0,
    title: (r) => String(r.title || "").toLowerCase(),
    zone: (r) => String(r.zone || "").toLowerCase(),
    players: (r) => r.playerCount || 0,
    issues: (r) => r.issueCount || 0,
    // Raid the report's log is assigned to (see annotateReportEvents); reports
    // without an assignment carry an empty label and group together.
    event: (r) => String(r.eventLabel || "").toLowerCase(),
};

function prepareReportList(reports, query = {}, opts = {}) {
    return sortAndPaginate(reports, query, {
        sortKeys: REPORT_SORT_KEYS,
        defaultSort: "date",
        pageSize: opts.pageSize,
        tiebreak: (a, b) => (b.generatedAt || 0) - (a.generatedAt || 0),
    });
}

// ---- detected logs (sorted by CHANNEL POST time, not detection time) ----

// Discord snowflake -> creation (post) timestamp in ms. The message id encodes
// exactly when it was posted, so we can recover the channel-post time for EVERY
// tracked log (old and new) without any API call or re-scan.
const DISCORD_EPOCH = 1420070400000;
function snowflakeTimestamp(id) {
    if (!id || !/^\d+$/.test(String(id))) return 0;
    try {
        return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
    } catch {
        return 0;
    }
}

// When the log was POSTED in the channel: prefer the stored postedAt, else derive
// it from the Discord message id, else fall back to the detection time.
const logPostedAt = (l) => l.postedAt || snowflakeTimestamp(l && l.messageId) || l.detectedAt || 0;
const LOG_SORT_KEYS = {
    date: logPostedAt,
    title: (l) => String(l.title || l.reportId || "").toLowerCase(),
    status: (l) => (l.status === "done" ? 1 : 0),
    // Category and channel are annotated onto the logs from Discord
    // (annotateLogCategories) — the route has to do that BEFORE sorting, else
    // only the current page carries them and the order would be arbitrary.
    category: (l) => String(l.categoryName || "").toLowerCase(),
    // The logs still waiting for a raid carry no label and lead the ascending
    // order: they are the ones the page is opened for.
    event: (l) => String(l.eventLabel || "").toLowerCase(),
    // The "Quelle" column links to the Discord message; what distinguishes the
    // rows there is the channel it was posted in.
    source: (l) => String(l.channelName || "").toLowerCase(),
};

function prepareLogList(logs, query = {}, opts = {}) {
    return sortAndPaginate(logs, query, {
        sortKeys: LOG_SORT_KEYS,
        defaultSort: "date",
        pageSize: opts.pageSize,
        tiebreak: (a, b) => logPostedAt(b) - logPostedAt(a),
    });
}

/**
 * Attach the Discord category (and channel name) to each log from a channel→
 * category map (discord.getChannelCategoryMap), so the list can show a category
 * badge — handy when logs come from several channels. Mutates the items in place
 * (render-only, not persisted) and returns them.
 */
function annotateLogCategories(items, catMap) {
    const map = catMap || {};
    for (const l of items || []) {
        const meta = l && map[l.channelId];
        if (meta) {
            l.categoryId = meta.categoryId || "";
            l.categoryName = meta.categoryName || "";
            l.channelName = meta.name || "";
        }
    }
    return items;
}

/**
 * Attach the tracked log a report was generated from — and through it the raid
 * event that log is assigned to — to each report. A report is only ever tied to
 * a raid indirectly: report.id === log.reportRefId, log.eventId === the raid.
 * Mutates the items in place (render-only, not persisted) and returns them.
 * @param {object[]} reports  report metadata (listReports())
 * @param {object[]} logs     tracked logs (listLogs())
 */
function annotateReportEvents(reports, logs) {
    const byRef = new Map();
    for (const l of logs || []) {
        if (l && l.reportRefId) byRef.set(l.reportRefId, l);
    }
    for (const r of reports || []) {
        const log = r && byRef.get(r.id);
        r.logId = log ? log.id : "";
        r.eventId = (log && log.eventId) || "";
        r.eventLabel = (log && log.eventLabel) || "";
        r.eventStartTime = (log && log.eventStartTime) || 0;
    }
    return reports;
}

module.exports = {
    prepareReportList, prepareLogList, sortAndPaginate, annotateLogCategories, annotateReportEvents,
    DEFAULT_PAGE_SIZE, REPORT_SORT_KEYS, LOG_SORT_KEYS,
    logPostedAt, snowflakeTimestamp,
};
