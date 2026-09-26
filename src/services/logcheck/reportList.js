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

// ---- the one list of the Log-Auswertung page (logs + reports without a log) ----
//
// The page used to show two tables for one thing: "Auswertungen" and "Erkannte
// Logs", with an evaluated log in both. Now every log is one row, whatever has
// been done with it, and a report built from a pasted link that has no log of
// its own is a row too (source "link"). The report's numbers ride on the row for
// the badge tooltip instead of being columns.

const CLA_FILTERS = ["all", "open", "unlinked", "done"];

const WCL_REPORT_URL = "https://classic.warcraftlogs.com/reports/";

function reportMeta(r) {
    if (!r) return null;
    return {
        id: r.id,
        url: `/r/${r.id}`,
        generatedAt: r.generatedAt || 0,
        playerCount: r.playerCount || 0,
        issueCount: r.issueCount || 0,
    };
}

/** One list row for a tracked log, with the report it was evaluated into (if any). */
function claRowFromLog(log, report) {
    const l = log || {};
    const sections = Array.isArray(l.sections) && l.sections.length
        ? l.sections.filter((s) => s === "cla" || s === "rpb")
        : (l.status === "done" ? ["cla"] : []);
    // The report knows the raids of the whole night; a log's own reading may be
    // from before the raid ended.
    const raids = (report && Array.isArray(report.raids) && report.raids.length)
        ? report.raids
        : (Array.isArray(l.raids) ? l.raids : []);
    return {
        kind: "log",
        id: l.id,
        logId: l.id,
        title: l.title || (report && report.title) || l.reportId || "",
        zone: (report && report.zone) || l.zone || "",
        reportId: l.reportId || "",
        wclUrl: l.link || (l.reportId ? `${WCL_REPORT_URL}${l.reportId}` : ""),
        postedAt: logPostedAt(l),
        source: l.messageId ? "channel" : "link",
        guildId: l.guildId || "",
        channelId: l.channelId || "",
        messageId: l.messageId || "",
        channelName: l.channelName || "",
        categoryId: l.categoryId || "",
        categoryName: l.categoryName || "",
        sections,
        report: reportMeta(report) || (l.reportRefId ? { id: l.reportRefId, url: l.reportUrl || `/r/${l.reportRefId}`, generatedAt: 0, playerCount: 0, issueCount: 0 } : null),
        raids,
        eventId: l.eventId || "",
        eventLabel: l.eventLabel || "",
        eventStartTime: l.eventStartTime || 0,
        eventLinkSource: l.eventLinkSource || "",
    };
}

/** One list row for a report that has no tracked log (built from a pasted link). */
function claRowFromReport(r) {
    return {
        kind: "report",
        id: `report:${r.id}`,
        logId: "",
        title: r.title || r.id,
        zone: r.zone || "",
        reportId: r.reportId || "",
        wclUrl: r.reportUrl || (r.reportId ? `${WCL_REPORT_URL}${r.reportId}` : ""),
        postedAt: r.generatedAt || 0,
        source: "link",
        guildId: "",
        channelId: "",
        messageId: "",
        channelName: "",
        categoryId: "",
        categoryName: "",
        // a report file carries its own halves; one without is a full CLA build
        sections: Array.isArray(r.sections) && r.sections.length ? r.sections : ["cla"],
        report: reportMeta(r),
        raids: Array.isArray(r.raids) ? r.raids : [],
        eventId: "",
        eventLabel: "",
        eventStartTime: 0,
        eventLinkSource: "",
    };
}

const CLA_FILTER_TESTS = {
    all: () => true,
    // nothing evaluated yet
    open: (row) => !row.sections.length,
    // a log waiting for its raid (a report without a log cannot be assigned)
    unlinked: (row) => row.kind === "log" && !row.eventId,
    // at least one half evaluated
    done: (row) => row.sections.length > 0,
};

const CLA_SORT_KEYS = {
    date: (row) => row.postedAt || 0,
    title: (row) => String(row.title || "").toLowerCase(),
    content: (row) => String((row.raids[0] && row.raids[0].label) || "").toLowerCase(),
    status: (row) => row.sections.length,
    // logs still waiting for a raid lead the ascending order
    event: (row) => String(row.eventLabel || "").toLowerCase(),
};

/**
 * Build the page's one list: every log (already filtered to the active guild by
 * the caller) plus every report no log at all points at, then filter, count and
 * sort + paginate.
 * @param {object[]} logs      tracked logs of the active guild
 * @param {object[]} reports   report metadata (listReports())
 * @param {object} query       { filter, sort, dir, page }
 * @param {object} [opts]      { pageSize, allLogs } — allLogs: every guild's logs, so a
 *   report whose log lives in another guild is not mistaken for a link report
 * @returns {{ page, filter, counts: {all,open,unlinked,done} }}
 */
function prepareClaList(logs, reports, query = {}, opts = {}) {
    const reportById = new Map((reports || []).map((r) => [r.id, r]));
    const referenced = new Set((opts.allLogs || logs || []).map((l) => l && l.reportRefId).filter(Boolean));
    const rows = [
        ...(logs || []).map((l) => claRowFromLog(l, reportById.get(l.reportRefId))),
        ...(reports || []).filter((r) => !referenced.has(r.id)).map(claRowFromReport),
    ];
    const counts = {};
    for (const f of CLA_FILTERS) counts[f] = rows.filter(CLA_FILTER_TESTS[f]).length;
    const filter = CLA_FILTERS.includes(query.filter) ? query.filter : "all";
    const page = sortAndPaginate(rows.filter(CLA_FILTER_TESTS[filter]), query, {
        sortKeys: CLA_SORT_KEYS,
        defaultSort: "date",
        pageSize: opts.pageSize,
        tiebreak: (a, b) => (b.postedAt || 0) - (a.postedAt || 0),
    });
    return { page, filter, counts };
}

module.exports = {
    prepareReportList, prepareLogList, sortAndPaginate, annotateLogCategories, annotateReportEvents,
    prepareClaList, claRowFromLog, claRowFromReport, CLA_FILTERS, CLA_SORT_KEYS,
    DEFAULT_PAGE_SIZE, REPORT_SORT_KEYS, LOG_SORT_KEYS,
    logPostedAt, snowflakeTimestamp,
};
