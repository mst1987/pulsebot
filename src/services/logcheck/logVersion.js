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
const { versionOfLog } = require("../events/storedVersion");
const { contentsForText, versionsOfContent } = require("../../config/raidContent");

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
 * reason — the log's host names another version than the raid plays, or its
 * raids exist only in other versions (an SSC log is TBC's). A log of unknown
 * version may go to any raid.
 */
function linkConflict(log, event, { config } = {}) {
    const eventVersion = knownVersion(event && event.versionId);
    if (!eventVersion) return "";
    const host = knownLogVersion(log, { config });
    const logVersions = host ? [host] : contentVersions(log);
    if (!logVersions.length || logVersions.includes(eventVersion)) return "";
    return `Dieses Log ist von ${logVersions.map(versionLabel).join(" oder ")}, der Raid von ${versionLabel(eventVersion)}. Ein Log gehört nur zu einem Raid seiner Version.`;
}

/**
 * The version a log's channel category is pinned to (config.categoryVersion),
 * "" when it is not — unlike categoryVersion no fallback to the main version,
 * which says nothing about the log. The config store is required late (as in
 * mainVersion.js), one that cannot be read counts as "nothing pinned".
 */
function pinnedCategoryVersion(log, { config } = {}) {
    const cat = str(log && log.categoryId);
    if (!cat) return "";
    let cfg = config;
    if (!cfg) {
        try {
            cfg = require("../../stores/configStore").getConfig() || {};
        } catch {
            cfg = {};
        }
    }
    const map = cfg.categoryVersion && typeof cfg.categoryVersion === "object" ? cfg.categoryVersion : {};
    return knownVersion(map[cat]);
}

/**
 * The raids a log covers: the ones read from Warcraft Logs (`raids`), else the
 * ones its title names in any version ("SSC + TK" → ssc, tk).
 */
function contentIdsOf(record) {
    const r = record || {};
    const read = (Array.isArray(r.raids) ? r.raids : []).map((x) => str(x && x.contentId)).filter(Boolean);
    if (read.length) return read;
    const title = str(r.title);
    if (!title) return [];
    return [...new Set(VERSIONS.flatMap((v) => contentsForText(title, { versionId: v.id })))];
}

/**
 * The versions all raids of a log can be from: SSC and TK only TBC, Hyjal TBC
 * and Forever (raidContent.versionsOfContent). [] when no raid is known or the
 * raids share no version.
 */
function contentVersions(record) {
    let common = null;
    for (const id of contentIdsOf(record)) {
        const versions = versionsOfContent(id);
        if (versions.length) common = common ? common.filter((v) => versions.includes(v)) : versions;
    }
    return common || [];
}

/**
 * The versions a log without a raid is listed in, [] for every version:
 *   1. the version its link's host names (knownLogVersion);
 *   2. the version of its raids when only one version has them (SSC, TK, Gruul: TBC);
 *   3. its channel category's pinned version, when its raids allow that version;
 *   4. the versions its raids allow (Hyjal: TBC and Forever);
 *   5. nothing known: every version — it waits for its raid there.
 * @param {object} record  a stored log, or a log row of the list (raids, title, categoryId, host)
 * @param {{ config?: object }} [opts]
 * @returns {string[]}
 */
function listedVersions(record, { config } = {}) {
    const host = knownLogVersion(record, { config });
    if (host) return [host];
    const byContent = contentVersions(record);
    if (byContent.length === 1) return byContent;
    const cat = pinnedCategoryVersion(record, { config });
    if (cat && (!byContent.length || byContent.includes(cat))) return [cat];
    return byContent;
}

/**
 * Whether a log or a report belongs in one version's list (#741, the web shows
 * one version at a time):
 *   - a log without a raid: in the versions it can be from (listedVersions — a
 *     log of SSC is no Forever log), in every version when nothing tells; it
 *     waits for its raid there as "nicht zugeordnet";
 *   - a log with a raid: only in the version of that raid (its stored version,
 *     storedVersion.versionOfLog; the version stamped at linking when the raid
 *     is no longer stored);
 *   - a report without a log (built from a pasted link): in its own version.
 * `versionId` "" lets everything through.
 * @param {{ kind?: string, eventId?: string, versionId?: string }} record  a stored log, or a row
 *   of the log list (reportList.js: kind "log" or "report")
 * @param {string} versionId
 * @param {{ config?: object }} [opts]
 */
function inVersionList(record, versionId, { config } = {}) {
    if (!versionId) return true;
    const r = record || {};
    const eventId = str(r.eventId);
    if (!eventId && r.kind !== "report") {
        const listed = listedVersions(r, { config });
        return !listed.length || listed.includes(versionId);
    }
    return ((eventId && versionOfLog(r)) || recordVersion(r)) === versionId;
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
    logcheckCapability, logcheckSupported, wclApiSite, wclClientFor, reportLink, linkConflict, unsupportedMessage, inVersionList, listedVersions,
};
