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
const logPostedAt = (l) => l.postedAt || l.detectedAt || 0;
const LOG_SORT_KEYS = {
    date: logPostedAt,
    title: (l) => String(l.title || l.reportId || "").toLowerCase(),
    status: (l) => (l.status === "done" ? 1 : 0),
};

function prepareLogList(logs, query = {}, opts = {}) {
    return sortAndPaginate(logs, query, {
        sortKeys: LOG_SORT_KEYS,
        defaultSort: "date",
        pageSize: opts.pageSize,
        tiebreak: (a, b) => logPostedAt(b) - logPostedAt(a),
    });
}

module.exports = {
    prepareReportList, prepareLogList, sortAndPaginate,
    DEFAULT_PAGE_SIZE, REPORT_SORT_KEYS, LOG_SORT_KEYS,
};
