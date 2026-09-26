const fs = require("fs");
const path = require("path");
const { raidSummary } = require("../utils/logcheck/raidProgress");
const { newId } = require("../utils/ids");
const { dataPath } = require("../config/paths");
const { writeJsonAtomic, readJsonFile } = require("./jsonStore");

// Reports are stored as JSON files under data/reports/<id>.json
const REPORTS_DIR = dataPath("reports");

function ensureDir() {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function filePath(id) {
    return path.join(REPORTS_DIR, `${id}.json`);
}

/**
 * Persist a report and return its id.
 *
 * Passing an existing `id` overwrites that report instead of creating a new one.
 * That is what lets the CLA and the RPB evaluation of the same log share a single
 * page: the second one loads the first, merges its sections in and writes back
 * under the same id, so the link posted to Discord stays valid and simply gains
 * more tabs.
 *
 * @param {object} report  the full report payload (meta + players)
 * @param {string} [id]    reuse this id instead of generating a fresh one
 */
function saveReport(report, id) {
    ensureDir();
    const reportId = id && /^[a-f0-9]{6,}$/i.test(id) ? id : newId();
    const payload = { ...report, id: reportId, generatedAt: report.generatedAt || Date.now() };
    writeJsonAtomic(filePath(reportId), payload, { space: 0 });
    return reportId;
}

/** Load a report by id, or null if it does not exist / is unreadable. */
function getReport(id) {
    if (!/^[a-f0-9]{6,}$/i.test(id)) return null;
    return readJsonFile(filePath(id), null);
}

/** Delete a report by id. Returns true if a file was removed. */
function deleteReport(id) {
    if (!/^[a-f0-9]{6,}$/i.test(id)) return false;
    try {
        fs.unlinkSync(filePath(id));
        return true;
    } catch {
        return false;
    }
}

// The metadata of a report file, remembered until that file changes.
//
// A stored report is a couple of megabytes — almost all of it the timeline —
// and listReports() parses the whole thing for a dozen header fields. That was
// affordable while one page called it once; it is not affordable now that a
// single Loot-Council request walks the reports again for every raider it looks
// at. The entry is keyed by the file's mtime and size, so a rebuilt report is
// read again by itself and a deleted one falls out of the map; nothing has to
// remember to invalidate anything.
//
// Only the *metadata* is kept, never the report itself: a dozen short fields
// per file is a few kilobytes, where the parsed reports would be hundreds of
// megabytes of resident objects.
const metaCache = new Map();

// The same for the part of a report the gear walk needs (charGear.js): the
// roster and three header fields, a twentieth of the file. Bounded: the newest
// evaluations are what anything asks for, and an entry falls out as soon as its
// file changes or the cache is full.
const rosterCache = new Map();
const MAX_ROSTER_CACHE = 60;

function stampOf(full) {
    const stat = fs.statSync(full);
    return `${stat.mtimeMs}:${stat.size}`;
}

/** A projection of one report file, remembered until the file changes. */
function cachedSlice(file, cache, project) {
    const full = path.join(REPORTS_DIR, file);
    const stamp = stampOf(full);
    const hit = cache.get(file);
    if (hit && hit.stamp === stamp) return hit.value;
    const value = project(JSON.parse(fs.readFileSync(full, "utf8")));
    if (cache.size >= MAX_ROSTER_CACHE) cache.delete(cache.keys().next().value);
    cache.set(file, { stamp, value });
    return value;
}

/**
 * A report reduced to what the gear walk reads: who was in the raid with their
 * armory, and when the evaluation was made. The rest of the file is the
 * timeline, which is 90 % of its size and of no use here — parsing it for every
 * raider on the loot council was minutes of work per page.
 */
function getReportRoster(id) {
    if (!/^[a-f0-9]{6,}$/i.test(id)) return null;
    try {
        return cachedSlice(`${id}.json`, rosterCache, (r) => ({
            id: r.id,
            title: r.title || "",
            generatedAt: r.generatedAt || 0,
            roster: Array.isArray(r.roster) ? r.roster : [],
            // Reports from before the roster existed carry the players instead,
            // and the gear findings read that fallback (charGearIssues.js).
            players: Array.isArray(r.players) ? r.players : [],
        }));
    } catch {
        return null;
    }
}

function metaOf(report) {
    return {
        id: report.id,
        title: report.title,
        zone: report.zone,
        date: report.date,
        generatedAt: report.generatedAt,
        // WCL report code + link (older reports may lack these).
        reportId: report.reportId || "",
        reportUrl: report.reportUrl || (report.reportId ? `https://classic.warcraftlogs.com/reports/${report.reportId}` : ""),
        playerCount: (report.players || []).length,
        issueCount: (report.players || []).reduce((n, p) => n + (p.issues || []).length, 0),
        sections: Array.isArray(report.sections) ? report.sections : [],
        // Which raids the log covered and how far each got ("Hyjal 3/5");
        // null for a report built before the progress was kept on it.
        raids: report.raidProgress ? raidSummary(report.raidProgress) : null,
    };
}

/** List all reports (lightweight metadata), newest first. */
function listReports() {
    ensureDir();
    const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
    const seen = new Set();
    const out = [];
    for (const f of files) {
        try {
            seen.add(f);
            out.push(cachedSlice(f, metaCache, metaOf));
        } catch {
            // skip unreadable file
        }
    }
    for (const cache of [metaCache, rosterCache]) {
        for (const f of cache.keys()) if (!seen.has(f)) cache.delete(f);
    }
    out.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
    return out;
}

/** Drop what is remembered about the files — tests only. */
function resetCache() {
    metaCache.clear();
    rosterCache.clear();
}

module.exports = { saveReport, getReport, getReportRoster, deleteReport, listReports, resetCache, REPORTS_DIR };
