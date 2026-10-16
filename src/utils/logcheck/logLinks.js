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

// The v1 site the log check has always asked for TBC: the classic host, which
// serves the fresh (Anniversary) reports as well. classes/warcraftlogs.js'
// default and logVersion.js' TBC entry.
const WCL_LEGACY_SITE = "https://classic.warcraftlogs.com";

/**
 * The host and the report id of a WCL link; a bare id has no host (#746):
 *   "https://fresh.warcraftlogs.com/reports/AbC#fight=3" -> { host: "fresh.warcraftlogs.com", id: "AbC" }
 *   "AbC"                                                 -> { host: "", id: "AbC" }
 * A .cn link counts as its .com twin; the host is lower case.
 * @returns {{ host: string, id: string }}
 */
function parseReportLink(reportUrlOrId) {
    if (!reportUrlOrId) return { host: "", id: "" };
    let input = reportUrlOrId.toString().trim().replace(".cn/", ".com/");
    let host = "";
    const marker = "warcraftlogs.com/reports/";
    const at = input.indexOf(marker);
    if (at > -1) {
        const sub = input.slice(0, at).replace(/^https?:\/\//i, "");
        if (/^([a-z0-9-]+\.)*$/i.test(sub)) host = `${sub}warcraftlogs.com`.toLowerCase();
        input = input.slice(at + marker.length);
    }
    // strip query string and #fragment (fight=, type=, ...)
    return { host, id: input.split("#")[0].split("?")[0].split("/")[0] };
}

module.exports = { extractWclLinks, parseReportLink, WCL_REPORT_RE, WCL_LEGACY_SITE };
