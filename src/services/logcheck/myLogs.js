// "Nur meine Raids" on the Log-Auswertung page: which rows of the list one
// account played in.
//
// The only record of who was in a log is its evaluation: the report's roster
// (and, for reports from before the roster existed, its players). A log that
// was never evaluated has no participant list and counts as "not mine".
//
// The account's characters are the ones "Mein Profil" lists for the row's game
// version (raiderProfileStore.charactersOfVersion - no main character, all of
// them) plus the ones the categories assign to the account
// (raiderCharactersStore.charactersForUser). Names are compared by their name
// part, realm and version prefix dropped (lootImport.nameKeyOf), the one key
// every store uses.

const profiles = require("../../stores/roster/raiderProfileStore");
const { charactersForUser } = require("../../stores/roster/raiderCharactersStore");
const { getReportRoster } = require("../../stores/loot/reportStore");

/** The name keys of everyone a report lists (roster, else the legacy players). */
function reportNameKeys(reportId) {
    const report = reportId ? getReportRoster(String(reportId)) : null;
    const keys = new Set();
    if (!report) return keys;
    for (const p of [...(report.roster || []), ...(report.players || [])]) {
        const key = profiles.nameKey(p && p.name);
        if (key) keys.add(key);
    }
    return keys;
}

/**
 * A predicate `(row) => boolean` over the rows of reportList.prepareClaList:
 * true when at least one of the account's characters is in the row's report.
 * Without an account, nothing is "mine".
 * @param {string} userId the Discord account
 */
function mineFilter(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return () => false;
    const profile = profiles.getProfile(uid);
    const assigned = charactersForUser(uid).map((c) => profiles.nameKey(c && c.character)).filter(Boolean);
    const byVersion = new Map();
    const namesFor = (versionId) => {
        const id = String(versionId || "");
        if (!byVersion.has(id)) {
            const own = profiles.charactersOfVersion(profile, id).map((c) => profiles.nameKey(c && (c.name || c.key)));
            byVersion.set(id, new Set([...own, ...assigned].filter(Boolean)));
        }
        return byVersion.get(id);
    };
    const reportCache = new Map();
    return (row) => {
        const reportId = row && row.report && row.report.id;
        if (!reportId) return false;
        const names = namesFor(row.versionId);
        if (!names.size) return false;
        if (!reportCache.has(reportId)) reportCache.set(reportId, reportNameKeys(reportId));
        const inReport = reportCache.get(reportId);
        for (const name of names) if (inReport.has(name)) return true;
        return false;
    };
}

module.exports = { mineFilter, reportNameKeys };
