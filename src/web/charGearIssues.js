// The latest gear issues per character, read out of the CLA evaluations that
// were already generated (data/reports/*.json — see reportStore.js).
//
// The roster overview wants "was ist zuletzt am Gear aufgefallen" for every
// character at a glance. Every stored report already carries its whole roster
// with the structured issue list utils/logcheck/gearIssues.js produced, so this
// needs no Warcraft-Logs call at all — it only has to walk the reports newest
// first and keep the first hit per character.
//
// Keyed like characterStore.js/lootStore.js (lowercased, realm suffix dropped),
// so a report's "Keslight" lines up with the loot history's "keslight".
// The slim slice: this reads the roster (or, on an old report, the players)
// and nothing else — see reportStore.js.
const { listReports, getReportRoster } = require("./reportStore");
const { splitPlayer, characterKeyOf } = require("../utils/loot/lootImport");
const { SLOT_NAMES } = require("../utils/logcheck/gearIssues");

// How many of the newest evaluations are read. Same bound (and reason) as
// characterInfo.js's MAX_LOCAL_REPORTS: far enough back to cover everyone who
// raided recently, without walking years of files on every page view.
const MAX_REPORTS = 40;

// Cap per character — the hover panel shows a list, not a full audit; the
// detail page (and the report itself) has the complete picture.
const MAX_ISSUES = 25;

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

// Same mapping as src/web/render.js's iconUrl(): WCL ships a bare asset name
// ("inv_helmet_21.jpg"), the CDN wants it lowercased without the extension.
function issueIconUrl(icon) {
    if (!icon) return "";
    return `${ICON_BASE}/${String(icon).replace(/\.(jpg|jpeg|png|gif)$/i, "").toLowerCase()}.jpg`;
}

// WCL's gear slot index -> the Battle.net equipment slot key the character
// page's paperdoll rows use, so a finding can sit on the row it is about.
const SLOT_KEYS = {
    0: "HEAD", 1: "NECK", 2: "SHOULDER", 3: "SHIRT", 4: "CHEST", 5: "WAIST", 6: "LEGS", 7: "FEET",
    8: "WRIST", 9: "HANDS", 10: "FINGER_1", 11: "FINGER_2", 12: "TRINKET_1", 13: "TRINKET_2",
    14: "BACK", 15: "MAIN_HAND", 16: "OFF_HAND", 17: "RANGED", 18: "TABARD",
};

function trimIssue(issue) {
    const hasSlot = issue.slot !== null && issue.slot !== undefined && issue.slot !== "";
    const slot = hasSlot ? Number(issue.slot) : NaN;
    return {
        kind: issue.kind || "",
        label: issue.label || "",
        severity: issue.severity === "high" ? "high" : "medium",
        itemId: issue.itemId ? String(issue.itemId) : "",
        itemName: issue.itemName || "",
        // "Ring 1" reads better than a bare slot index, and two findings on two
        // different rings are otherwise indistinguishable in the list.
        slotName: Number.isFinite(slot) ? (SLOT_NAMES[slot] || "") : "",
        // The paperdoll row the finding belongs to ("" without a slot).
        slotKey: Number.isFinite(slot) ? (SLOT_KEYS[slot] || "") : "",
        iconUrl: issueIconUrl(issue.icon),
    };
}

// High findings (a missing item/enchant) before the medium ones (a gem nit),
// so a long list opens with what actually costs the raid something.
function bySeverity(a, b) {
    if (a.severity === b.severity) return 0;
    return a.severity === "high" ? -1 : 1;
}

// A report's own file never changes once written (saveReport() always mints a
// new id), so the condensed form is worth caching for the process' lifetime —
// the roster page would otherwise re-parse the same 40 JSON files per request.
const condensedCache = new Map();

/**
 * One report reduced to what this module needs: every raider in it with their
 * gear issues. Prefers `roster` (holds everyone, including raiders without a
 * single issue) and falls back to `players` for reports built before the
 * roster existed.
 */
function condenseReport(meta) {
    const cached = condensedCache.get(meta.id);
    if (cached) return cached;
    const report = getReportRoster(meta.id);
    const entries = [];
    const rows = (report && report.roster && report.roster.length)
        ? report.roster
        : ((report && report.players) || []);
    for (const row of rows) {
        const key = characterKeyOf(row.name);
        if (!key) continue;
        const issues = Array.isArray(row.issues) ? row.issues.filter(Boolean) : [];
        entries.push({
            key,
            character: splitPlayer(row.name).character,
            className: row.type || "",
            issueCount: issues.length,
            // Sort first, cap second — a capped list must not drop a high
            // finding in favour of a medium one that happened to come first.
            issues: issues.map(trimIssue).sort(bySeverity).slice(0, MAX_ISSUES),
        });
    }
    const condensed = { id: meta.id, entries };
    condensedCache.set(meta.id, condensed);
    return condensed;
}

/**
 * Character key -> the newest evaluation that contains them, with that
 * evaluation's gear issues.
 *
 * @param {object} opts { maxReports }
 * @returns {Object<string, {character, className, issues, issueCount, reportRefId,
 *                           reportId, reportUrl, reportTitle, zone, generatedAt}>}
 */
function latestIssuesByCharacter(opts = {}) {
    const maxReports = opts.maxReports > 0 ? opts.maxReports : MAX_REPORTS;
    const byKey = {};
    // listReports() is already sorted newest first, so the first report that
    // mentions a character is their latest one.
    for (const meta of listReports().slice(0, maxReports)) {
        const { entries } = condenseReport(meta);
        for (const entry of entries) {
            if (byKey[entry.key]) continue;
            byKey[entry.key] = {
                character: entry.character,
                className: entry.className,
                issues: entry.issues,
                issueCount: entry.issueCount,
                reportRefId: meta.id,
                reportId: meta.reportId || "",
                reportUrl: meta.reportUrl || "",
                reportTitle: meta.title || "",
                zone: meta.zone || "",
                generatedAt: meta.generatedAt || 0,
            };
        }
    }
    return byKey;
}

/** The same entry for a single character (by name), or null. */
function issuesForCharacter(character, opts = {}) {
    const key = characterKeyOf(character);
    if (!key) return null;
    return latestIssuesByCharacter(opts)[key] || null;
}

module.exports = { latestIssuesByCharacter, issuesForCharacter, issueIconUrl, SLOT_KEYS, MAX_REPORTS, MAX_ISSUES };
