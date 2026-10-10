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
// Whether the log check CAN read a version is logcheckCapability (#747): its
// rule set (utils/logcheck/rules.js) must be ready AND a Warcraft-Logs site
// must be known for it. Today that is TBC only — Forever's rule set is
// prepared but not ready, and its site is not known yet. Whether it DOES is
// the feature "logcheck" of services/events/versionCapabilities.js (#761):
// possible as above, and not switched off in Einstellungen → Spielversion.
// A log of any other version is refused with a clear message before a single
// request goes to Warcraft Logs (UnsupportedVersionError in utils/logcheck/report.js).
const WarcraftLogs = require("../../classes/warcraftlogs");
const { parseReportLink } = require("../../utils/logcheck/logLinks");
const { LEGACY_VERSION, VERSIONS } = require("../../config/gameVersions");
const { knownVersion, versionOfEvent, mainVersionFor } = require("../events/mainVersion");
const { versionLinks, versionLabel } = require("../events/versionSettings");

const capabilities = require("../events/versionCapabilities");

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
 * Whether the log check reads a version: possible (log rule set ready, Warcraft-Logs
 * site known: versionCapabilities.logcheckCapability) and not switched off for it
 * (#761) - asked through the one source.
 */
function logcheckSupported(versionId, opts) {
    return capabilities.featureOn(versionId, "logcheck", opts);
}

// The possibility and the v1 site live with the feature source (#761); kept here
// under their old names for the log check's callers.
const { logcheckCapability, wclApiSite } = capabilities;

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
 * The German refusal for a version the log check does not read (web and orga):
 * switched off in the settings (#761) says so, anything else "not yet".
 */
function unsupportedMessage(versionId, opts) {
    const state = capabilities.featureState(versionId, "logcheck", opts);
    if (state.possible && !state.enabled) return state.message;
    return `Logs von ${versionLabel(versionId)} werden noch nicht ausgewertet.`;
}

module.exports = {
    versionOfHost, linkVersion, resolveReportVersion, recordVersion, knownLogVersion, categoryVersion,
    logcheckCapability, logcheckSupported, wclApiSite, wclClientFor, reportLink, linkConflict, unsupportedMessage,
};
