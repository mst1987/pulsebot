// Figuring out which class/spec the characters in the loot history play.
//
// Three sources, cheapest first:
//   1. the loot export itself — RCLootcouncil ships a class per item, Gargul does not
//   2. an already evaluated CLA report — its roster knows every raider's class (local
//      file, no API call), but not their spec
//   3. the Warcraft-Logs report of the raid the loot came from — the only source for
//      the spec, found via the log that is assigned to that event
// Everything resolved is cached in characterStore, so this only ever has to look up
// what is still unknown.

const { characters: lootCharacters, listByCharacter } = require("./lootStore");
const { listReports, getReport } = require("./reportStore");
const { listLogsForEvent } = require("./logStore");
const charStore = require("./characterStore");
const WarcraftLogs = require("../classes/warcraftlogs");
const { rosterFromFights, rosterFromTable, mergeRosters } = require("../utils/wclRoster");
const { VALID_CLASSES } = require("../utils/logcheck/common");

// How many CLA reports are read for their roster, and how many Warcraft-Logs
// reports one run may fetch. Both bound the work per click; what did not fit is
// reported back so a second run picks it up.
const MAX_LOCAL_REPORTS = 40;
const MAX_WCL_REPORTS = 8;

/** Export class tokens ("WARRIOR", "warrior") to the spelling WCL/the UI uses. */
function normalizeClassName(raw) {
    const clean = String(raw || "").trim();
    if (!clean) return "";
    return VALID_CLASSES.find((c) => c.toLowerCase() === clean.toLowerCase()) || "";
}

/** Save every class the loot export itself carried. Returns how many were stored. */
function rememberFromLoot(items) {
    let saved = 0;
    for (const item of items || []) {
        const className = normalizeClassName(item && item.class);
        if (!className || !item.character) continue;
        if (charStore.saveCharacter(item.character, { className, source: "export" })) saved += 1;
    }
    return saved;
}

/**
 * The loot characters plus what is known about their class/spec.
 * @returns [{ key, character, realm, count, categoryIds, className, spec, source, reportId }]
 */
function annotatedCharacters() {
    const known = charStore.characterMap();
    return lootCharacters().map((c) => {
        const info = known[c.key] || {};
        return {
            ...c,
            className: info.className || "",
            spec: info.spec || "",
            source: info.source || "",
            reportId: info.reportId || "",
        };
    });
}

// Distinct Warcraft-Logs report ids of the logs assigned to the events a
// character got loot in — the reports that can tell us their spec.
function reportIdsForCharacter(character) {
    const ids = new Set();
    for (const item of listByCharacter(character)) {
        for (const log of listLogsForEvent(item.eventId)) {
            if (log.reportId) ids.add(log.reportId);
        }
    }
    return [...ids];
}

// name (lowercase) -> class, from the already generated CLA evaluations.
function classesFromStoredReports(limit = MAX_LOCAL_REPORTS) {
    const byName = {};
    for (const meta of listReports().slice(0, limit)) {
        const report = getReport(meta.id);
        for (const player of (report && report.roster) || []) {
            const name = String(player.name || "").trim();
            const className = normalizeClassName(player.type);
            if (!name || !className) continue;
            const key = name.toLowerCase();
            if (!byName[key]) byName[key] = { name, className };
        }
    }
    return byName;
}

// Class + spec for everyone in one Warcraft-Logs report. `fights` alone already
// covers the class; the summary table is what carries specs/talents, so a failure
// there still leaves usable data.
async function rosterForReport(wcl, reportId) {
    const fights = await wcl.getFights(reportId);
    let table = null;
    try {
        table = await wcl.getSummary(reportId, 0, (fights && fights.end) || 999999999999);
    } catch (e) {
        console.error(`WCL summary for ${reportId} failed:`, e.message);
    }
    return mergeRosters(rosterFromFights(fights), rosterFromTable(table));
}

/**
 * Fill in the class/spec that is still missing for the loot characters.
 * @param {object} opts { maxReports }
 * @returns {Promise<{fromExport, fromReports, fromWcl, checkedReports, pendingReports,
 *                    missing: string[], unlinked: string[], error: string}>}
 */
async function resolveMissing(opts = {}) {
    const maxReports = opts.maxReports > 0 ? opts.maxReports : MAX_WCL_REPORTS;
    const result = {
        fromExport: 0, fromReports: 0, fromWcl: 0,
        checkedReports: 0, pendingReports: 0,
        missing: [], unlinked: [], error: "",
    };

    // 1. the export's own class
    for (const c of annotatedCharacters()) {
        if (c.className) continue;
        const item = listByCharacter(c.character).find((it) => normalizeClassName(it.class));
        if (item && charStore.saveCharacter(c.character, { className: normalizeClassName(item.class), source: "export" })) {
            result.fromExport += 1;
        }
    }

    // 2. the rosters of the already evaluated CLA reports
    const stillMissingClass = annotatedCharacters().filter((c) => !c.className);
    if (stillMissingClass.length) {
        const byName = classesFromStoredReports();
        for (const c of stillMissingClass) {
            const hit = byName[String(c.character || "").toLowerCase()];
            if (hit && charStore.saveCharacter(c.character, { className: hit.className, source: "report" })) {
                result.fromReports += 1;
            }
        }
    }

    // 3. the raid's Warcraft-Logs report — the only source for the spec
    const needSpec = annotatedCharacters().filter((c) => !c.spec || !c.className);
    if (!needSpec.length) return result;

    const wanted = new Map(); // reportId -> characters waiting for it
    for (const c of needSpec) {
        const ids = reportIdsForCharacter(c.character);
        if (!ids.length) {
            result.unlinked.push(c.character);
            continue;
        }
        for (const id of ids) {
            if (!wanted.has(id)) wanted.set(id, []);
            wanted.get(id).push(c.character);
        }
    }
    // `missing` always means "still without a class" — a character whose spec alone
    // is unknown is listed under `unlinked` (no log to read it from), not as missing.
    if (!wanted.size) {
        result.missing = needSpec.filter((c) => !c.className).map((c) => c.character);
        return result;
    }

    let wcl;
    try {
        wcl = new WarcraftLogs();
    } catch {
        result.error = "WCL-API-Key fehlt (WARCRAFTLOGS_API_KEY in .env) — Specs können nicht aus den Logs gelesen werden.";
        return result;
    }

    const reportIds = [...wanted.keys()];
    result.pendingReports = Math.max(0, reportIds.length - maxReports);
    for (const reportId of reportIds.slice(0, maxReports)) {
        let roster;
        try {
            roster = await rosterForReport(wcl, reportId);
        } catch (e) {
            console.error(`WCL report ${reportId} could not be read:`, e.message);
            continue;
        }
        result.checkedReports += 1;
        // Store everyone the report knows, not just who we were looking for — the
        // next character is then already covered without another API call.
        for (const entry of roster) {
            if (charStore.saveCharacter(entry.name, {
                className: entry.className, spec: entry.spec, source: "wcl", reportId,
            })) {
                result.fromWcl += 1;
            }
        }
    }

    result.missing = annotatedCharacters().filter((c) => !c.className).map((c) => c.character);
    return result;
}

module.exports = {
    annotatedCharacters, rememberFromLoot, resolveMissing, normalizeClassName,
    reportIdsForCharacter, classesFromStoredReports, rosterForReport,
    MAX_WCL_REPORTS, MAX_LOCAL_REPORTS,
};
