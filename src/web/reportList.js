// Pure sorting + pagination for the CLA report list. Kept framework-free and
// side-effect-free so it is trivially unit-testable; the server route feeds it
// listReports() output plus the ?sort/?dir/?page query params.

const DEFAULT_PAGE_SIZE = 20;

// Sort key -> value extractor. "date" (report creation time) is the default.
const SORT_KEYS = {
    date: (r) => r.generatedAt || 0,
    title: (r) => String(r.title || "").toLowerCase(),
    zone: (r) => String(r.zone || "").toLowerCase(),
    players: (r) => r.playerCount || 0,
    issues: (r) => r.issueCount || 0,
};

function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Sort + paginate a report list.
 * @param {object[]} reports  listReports() metadata
 * @param {object} query      { sort, dir, page } (usually raw query-string values)
 * @param {object} [opts]     { pageSize }
 * @returns {{ items, sort, dir, page, totalPages, total, pageSize }}
 *   `sort`/`dir`/`page` are the normalised, validated values actually applied.
 */
function prepareReportList(reports, query = {}, opts = {}) {
    const pageSize = opts.pageSize > 0 ? opts.pageSize : DEFAULT_PAGE_SIZE;
    const list = Array.isArray(reports) ? reports : [];

    const sort = SORT_KEYS[query.sort] ? query.sort : "date";
    const dir = query.dir === "asc" ? "asc" : "desc";
    const keyFn = SORT_KEYS[sort];

    const sorted = list.slice().sort((a, b) => {
        const av = keyFn(a);
        const bv = keyFn(b);
        let cmp;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        cmp = dir === "asc" ? cmp : -cmp;
        if (cmp !== 0) return cmp;
        // Stable tiebreak, independent of direction: newest first.
        return (b.generatedAt || 0) - (a.generatedAt || 0);
    });

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, toInt(query.page, 1)), totalPages);
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);

    return { items, sort, dir, page, totalPages, total, pageSize };
}

module.exports = { prepareReportList, SORT_KEYS, DEFAULT_PAGE_SIZE };
