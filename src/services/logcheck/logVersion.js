// The game version of a Warcraft-Logs report (#746), and whether the log check
// can read it. A log or a report knows its version once, from the first answer
// of:
//
//   1. the raid it is linked to (versionOfEvent)
//   2. the host of its link: the version whose Warcraft-Logs site
//      (Einstellungen → Spielversion, versionSettings' wclSite) is that host.
//      Which host belongs to which version is a setting, never a table here; a
//      host no version names, or one two versions share, tells nothing
//   3. LEGACY_VERSION (TBC) — also what every log and report stored before
//      #746 counts as
//
// Whether the log check can read a version is logcheckCapability (#747): its
// rule set (utils/logcheck/rules.js) must be ready AND a Warcraft-Logs site
// must be known for it. Today that is TBC only — Forever's rule set is
// prepared but not ready, and its site is not known yet. A log of any other
// version is refused with a clear message before a single request goes to
// Warcraft Logs (UnsupportedVersionError in utils/logcheck/report.js).
const WarcraftLogs = require("../../classes/warcraftlogs");
const { parseReportLink, WCL_LEGACY_SITE } = require("../../utils/logcheck/logLinks");
const { logcheckRules } = require("../../utils/logcheck/rules");
const { LEGACY_VERSION, VERSIONS } = require("../../config/gameVersions");
const { knownVersion, versionOfEvent, mainVersionFor } = require("../events/mainVersion");
const { versionLinks, versionLabel } = require("../events/versionSettings");
const { versionOfLog } = require("../events/storedVersion");

// The v1 site the log check asks for a version, where it is fixed in code.
// TBC keeps the classic host the CLA port has always asked (it serves the
// fresh reports too), so nothing changes for TBC; every other version asks the
// Warcraft-Logs site of its settings (Einstellungen → Spielversion).
const LOGCHECK_VERSIONS = {
    tbc: { apiSite: WCL_LEGACY_SITE },
};

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/** The host of a site origin ("https://fresh.warcraftlogs.com" → "fresh.warcraftlogs.com"), "" for none. */
function hostOfSite(site) {
    try {
        return site ? new URL(site).hostname.toLowerCase() : "";
    } catch {
        return "";
    }
}

/**
 * The version whose Warcraft-Logs site is `host`, "" when no version or more
 * than one names it.
 * @param {string} host  e.g. "fresh.warcraftlogs.com"
 * @param {{ config?: object }} [opts]
 */
function versionOfHost(host, { config } = {}) {
    const h = str(host).toLowerCase();
    if (!h) return "";
    const hits = VERSIONS.map((v) => v.id).filter((id) => hostOfSite(versionLinks(id, { config }).wclSite) === h);
    return hits.length === 1 ? hits[0] : "";
}

/**
 * Host, report id and the version the link alone tells.
 * @param {string} link  a WCL link or a bare report id
 * @returns {{ host: string, reportId: string, hostVersionId: string }}  hostVersionId "" = the host tells nothing
 */
function linkVersion(link, { config } = {}) {
    const { host, id } = parseReportLink(link);
    return { host, reportId: id, hostVersionId: versionOfHost(host, { config }) };
}

/**
 * The version of a report about to be built: the linked raid's, else the
 * one handed in (a tracked log's stored version), else the link's host's,
 * else TBC.
 * @param {{ event?: object, versionId?: string, host?: string, config?: object }} src
 * @returns {{ versionId: string, from: "event"|"log"|"host"|"default" }}
 */
function resolveReportVersion({ event, versionId, host, config } = {}) {
    if (event) return { versionId: versionOfEvent(event, { config }), from: "event" };
    const own = knownVersion(versionId);
    if (own) return { versionId: own, from: "log" };
    const byHost = versionOfHost(host, { config });
    if (byHost) return { versionId: byHost, from: "host" };
    return { versionId: LEGACY_VERSION, from: "default" };
}

/** The version of a stored log or report; one stored before #746 is TBC. */
function recordVersion(record) {
    return knownVersion(record && record.versionId) || LEGACY_VERSION;
}

/**
 * The version a log is *known* to belong to, for the log → raid match: the one
 * its host told when it was detected (`hostVersionId`, "" = nothing), for a log
 * from before #746 the host of its link read now. "" when unknown — then the
 * channel's category breaks a tie (categoryVersion).
 */
function knownLogVersion(log, { config } = {}) {
    const l = log || {};
    if (l.hostVersionId !== undefined) return knownVersion(l.hostVersionId);
    return linkVersion(l.link || l.wclUrl || "", { config }).hostVersionId;
}

/** The version the category of a log's channel plays, "" without a category. */
function categoryVersion(log, { config } = {}) {
    const cat = str(log && log.categoryId);
    return cat ? mainVersionFor({ categoryId: cat, config }) : "";
}

/**
 * Whether the log check can read a version, and why not — the hook the
 * per-version feature matrix (#761) reads. Possible only when the version's
 * rule set is ready AND a Warcraft-Logs site is known for it.
 * @param {string} versionId
 * @param {{ config?: object }} [opts]
 * @returns {{ possible: boolean, reason: ""|"unknown_version"|"no_rules"|"rules_not_ready"|"no_site", message: string, missing: string[] }}
 *   `message` is the German reason for a tooltip, `missing` what the rule set still lacks
 */
function logcheckCapability(versionId, { config } = {}) {
    const id = knownVersion(versionId);
    const no = (reason, message, missing = []) => ({ possible: false, reason, message, missing });
    if (!id) return no("unknown_version", "Unbekannte Spielversion.");
    const label = versionLabel(id);
    const rules = logcheckRules(id);
    if (!rules) return no("no_rules", `Für ${label} gibt es keine Logcheck-Regeln.`);
    if (!rules.ready) return no("rules_not_ready", `Die Logcheck-Regeln für ${label} sind noch nicht fertig.`, [...rules.missing]);
    if (!wclApiSite(id, { config })) return no("no_site", `Für ${label} ist keine Warcraft-Logs-Seite eingetragen.`);
    return { possible: true, reason: "", message: "", missing: [] };
}

/** Whether the log check reads a version: its rule set is ready and its Warcraft-Logs site known. */
function logcheckSupported(versionId, opts) {
    return logcheckCapability(versionId, opts).possible;
}

/** The v1 site the log check asks for a version, "" when it has none. */
function wclApiSite(versionId, { config } = {}) {
    const own = LOGCHECK_VERSIONS[str(versionId)];
    if (own && own.apiSite) return own.apiSite;
    return knownVersion(versionId) ? versionLinks(versionId, { config }).wclSite : "";
}

/**
 * A v1 client for a version's site. Throws like the constructor without an API
 * key, and returns null for a version without a site to ask.
 */
function wclClientFor(versionId, { config, apiKey } = {}) {
    const site = wclApiSite(versionId, { config });
    if (!site) return null;
    return new WarcraftLogs(apiKey, { site });
}

/**
 * The link of a report on Warcraft Logs: on the host it was posted with, else
 * on the site of its version, "" without either or a usable id.
 */
function reportLink({ host, reportId, versionId } = {}, { config } = {}) {
    const id = str(reportId);
    if (!/^[A-Za-z0-9]+$/.test(id)) return "";
    const h = str(host).toLowerCase();
    if (/^([a-z0-9-]+\.)*warcraftlogs\.com$/.test(h)) return `https://${h}/reports/${id}`;
    return versionLinks(recordVersion({ versionId }), { config }).wclReport(id);
}

/**
 * Why a log may not be linked to a raid: "" when it may, else the German
 * reason — the log's host names another version than the raid plays. A log of
 * unknown version may go to any raid.
 */
function linkConflict(log, event, { config } = {}) {
    const logVersion = knownLogVersion(log, { config });
    const eventVersion = knownVersion(event && event.versionId);
    if (!logVersion || !eventVersion || logVersion === eventVersion) return "";
    return `Dieses Log ist von ${versionLabel(logVersion)}, der Raid von ${versionLabel(eventVersion)}. Ein Log gehört nur zu einem Raid seiner Version.`;
}

/**
 * Whether a log or a report belongs in one version's list (#741, the web shows
 * one version at a time):
 *   - a log without a raid: in every version, as "nicht zugeordnet" — it waits
 *     for its raid, and whoever looks at either version may link it;
 *   - a log with a raid: only in the version of that raid (its stored version,
 *     storedVersion.versionOfLog; the version stamped at linking when the raid
 *     is no longer stored);
 *   - a report without a log (built from a pasted link): in its own version.
 * `versionId` "" lets everything through.
 * @param {{ kind?: string, eventId?: string, versionId?: string }} record  a stored log, or a row
 *   of the log list (reportList.js: kind "log" or "report")
 * @param {string} versionId
 */
function inVersionList(record, versionId) {
    if (!versionId) return true;
    const r = record || {};
    const eventId = str(r.eventId);
    if (!eventId && r.kind !== "report") return true;
    return ((eventId && versionOfLog(r)) || recordVersion(r)) === versionId;
}

/** The German refusal for a version the log check has no rules for (web and orga). */
function unsupportedMessage(versionId) {
    return `Logs von ${versionLabel(versionId)} werden noch nicht ausgewertet.`;
}

module.exports = {
    LOGCHECK_VERSIONS,
    versionOfHost, linkVersion, resolveReportVersion, recordVersion, knownLogVersion, categoryVersion,
    logcheckCapability, logcheckSupported, wclApiSite, wclClientFor, reportLink, linkConflict, unsupportedMessage, inVersionList,
};
