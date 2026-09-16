// Recurring events per raid category (#289): the series themselves and what the
// scheduler (eventSeries.js) did with each of their dates.
//
// `data/settings/event-series.json` = {
//   series: { [categoryId]: { categoryId, guildId, enabled, weekdays, time, raidTemplateId,
//                              daysBefore, title, skipDates, leaderId, updatedAt, updatedBy, updatedByName } },
//   runs:   { [categoryId]: { [isoDate]: { status, at, eventId, channelId, channelName, error, attempts, messageError } } },
//   lastRun: { at, created, failed, skipped, error } | null
// }
//
// One series per category. A run mark is the "never twice" guarantee: it is
// written *before* the event is created (status "creating") and a date that has
// any mark other than a retryable "failed" is never created again — not after a
// restart, not when two sweeps overlap, not when the series is deleted and set
// up anew (the marks outlive the series on purpose).
//
// Kept out of the settings config: the scheduler writes here on every creation,
// and a PATCH of the settings page must never race it.

const fs = require("fs");
const path = require("path");

let file = path.join(__dirname, "..", "..", "data", "settings", "event-series.json");

const EMPTY = () => ({ series: {}, runs: {}, lastRun: null });
const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!isMap(data)) return EMPTY();
        return {
            series: isMap(data.series) ? data.series : {},
            runs: isMap(data.runs) ? data.runs : {},
            lastRun: isMap(data.lastRun) ? data.lastRun : null,
        };
    } catch {
        return EMPTY();
    }
}

function writeAll(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Every stored series, keyed by category id. */
function listSeries() {
    return { ...readAll().series };
}

/** One category's series, or null. */
function getSeries(categoryId) {
    return readAll().series[String(categoryId || "")] || null;
}

/** Store an already normalised series (eventSeries.normalizeSeries) under its category. */
function saveSeries(series) {
    const id = String((series && series.categoryId) || "");
    if (!id) return null;
    const data = readAll();
    data.series[id] = { ...series, categoryId: id };
    writeAll(data);
    return data.series[id];
}

/** Remove a category's series. Its run marks stay, so a new series never repeats a date. */
function deleteSeries(categoryId) {
    const id = String(categoryId || "");
    const data = readAll();
    if (!data.series[id]) return false;
    delete data.series[id];
    writeAll(data);
    return true;
}

/** The run marks of one category: `{ [isoDate]: mark }`. */
function getRuns(categoryId) {
    return { ...(readAll().runs[String(categoryId || "")] || {}) };
}

/** Every run mark: `{ [categoryId]: { [isoDate]: mark } }`. */
function listRuns() {
    return readAll().runs;
}

/**
 * Claim a date before creating its event. Returns false when the date already
 * has a mark — the caller then must not create anything. A "failed" mark may be
 * claimed again while `retry` allows it (attempts are counted on).
 */
function claimDate(categoryId, date, { at = Date.now(), retry = () => false } = {}) {
    const cat = String(categoryId || "");
    const day = String(date || "");
    if (!cat || !day) return false;
    const data = readAll();
    const runs = data.runs[cat] || {};
    const current = runs[day];
    if (current && !(current.status === "failed" && retry(current))) return false;
    runs[day] = { status: "creating", at, attempts: ((current && current.attempts) || 0) + 1 };
    data.runs[cat] = runs;
    writeAll(data);
    return true;
}

/** Record what happened to a date (merged into its mark). */
function setRun(categoryId, date, patch) {
    const cat = String(categoryId || "");
    const day = String(date || "");
    if (!cat || !day) return null;
    const data = readAll();
    const runs = data.runs[cat] || {};
    runs[day] = { ...(runs[day] || {}), ...(patch || {}) };
    data.runs[cat] = runs;
    writeAll(data);
    return runs[day];
}

/** Drop a date's mark (the orga asked for another attempt). */
function clearRun(categoryId, date) {
    const cat = String(categoryId || "");
    const data = readAll();
    if (!data.runs[cat] || !data.runs[cat][date]) return false;
    delete data.runs[cat][date];
    if (!Object.keys(data.runs[cat]).length) delete data.runs[cat];
    writeAll(data);
    return true;
}

/** Drop marks of dates older than `maxAgeDays` before `today` ("yyyy-MM-dd"). */
function pruneRuns(today, maxAgeDays = 60) {
    const limit = new Date(`${today}T00:00:00Z`).getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(limit)) return 0;
    const data = readAll();
    let dropped = 0;
    for (const [cat, runs] of Object.entries(data.runs)) {
        for (const day of Object.keys(runs)) {
            if (new Date(`${day}T00:00:00Z`).getTime() < limit) {
                delete runs[day];
                dropped += 1;
            }
        }
        if (!Object.keys(runs).length) delete data.runs[cat];
    }
    if (dropped) writeAll(data);
    return dropped;
}

function getLastRun() {
    return readAll().lastRun;
}

function setLastRun(lastRun) {
    const data = readAll();
    data.lastRun = lastRun;
    writeAll(data);
}

/** Test-only: point the store at another file. */
function _setFileForTests(next) {
    file = next;
}

module.exports = {
    listSeries, getSeries, saveSeries, deleteSeries, getRuns, listRuns, claimDate, setRun, clearRun, pruneRuns,
    getLastRun, setLastRun, _setFileForTests,
};
