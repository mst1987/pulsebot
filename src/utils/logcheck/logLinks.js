// Pure helpers to find Warcraft-Logs report links in arbitrary text (a Discord
// message's content, embeds, or link buttons). No Discord or network access —
// kept separate from the channel watcher so it is trivially unit-testable.

// Matches https://<sub>.warcraftlogs.com|cn/reports/<id> and captures the id.
// Report ids are alphanumeric; the id capture stops before #fragment / ?query / /.
const WCL_REPORT_RE = /https?:\/\/[a-z0-9.-]*warcraftlogs\.(?:com|cn)\/reports\/([a-zA-Z0-9]+)/gi;

/**
 * Extract all distinct Warcraft-Logs report links from a text blob.
 * @param {string} text
 * @returns {Array<{link: string, reportId: string}>} deduplicated by reportId, in order of appearance
 */
function extractWclLinks(text) {
    const out = [];
    if (!text) return out;
    const seen = new Set();
    const str = String(text);
    WCL_REPORT_RE.lastIndex = 0;
    let m;
    while ((m = WCL_REPORT_RE.exec(str)) !== null) {
        const reportId = m[1];
        if (seen.has(reportId)) continue;
        seen.add(reportId);
        // Normalise the .cn host to .com so downstream (WarcraftLogs client) is happy.
        out.push({ link: m[0].replace(".cn/", ".com/"), reportId });
    }
    return out;
}

module.exports = { extractWclLinks, WCL_REPORT_RE };
