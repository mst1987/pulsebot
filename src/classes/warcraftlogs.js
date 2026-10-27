const { createClient } = require("./httpClient");
const { parseReportLink, WCL_LEGACY_SITE } = require("../utils/logcheck/logLinks");

// v1 tables of a whole raid night can take a while; this caps a hung request.
const REQUEST_TIMEOUT_MS = 60000;

/**
 * Client for the Warcraft Logs **v1** API (the "V1 Client Key" from the WCL profile).
 * Mirrors the endpoints the CLA spreadsheet uses:
 *   - report/fights/{id}            -> fights, enemies, zone, title, start
 *   - report/tables/summary/{id}    -> per-fight player summary incl. gear snapshot
 *   - report/tables/casts/{id}      -> casts (buffs/consumables) over a time range
 *   - report/tables/buffs/{id}      -> buff uptimes over a time range
 *   - report/events/summary/{id}    -> raw events (used for raid start/end detection)
 *
 * The API key is read from process.env.WARCRAFTLOGS_API_KEY.
 *
 * Error contract: every request **throws** — an ApiError (classes/httpClient.js)
 * with `status`/`kind`, which still carries axios' `response`, so the callers
 * that print `e.response.status` (utils/logcheck/report.js) keep working. GETs
 * are retried on 5xx, network errors and timeouts, never on a 4xx (e.g. WCL's
 * 429 rate limit). Every caller catches and degrades on its own.
 *
 * Why v1 and v2 both stay (#429): v2 (warcraftlogsV2.js) is optional — its
 * OAuth client lives in the settings and may be missing — while this key is
 * the one the bot needs anyway. The importers and why each stays on v1:
 *   - utils/logcheck/report.js    the whole log check: summary, casts, buffs,
 *                                 debuffs, damage, deaths tables and raw events,
 *                                 read as v1 answers throughout the analyzers; on
 *                                 the site of the log's version (#746, through
 *                                 services/logcheck/logVersion.js wclClientFor)
 *   - commands/apply/applyModal   getParses (character rankings on the fresh
 *                                 host, analyzeApplicant), then report.js
 *   - services/characters/characterInfo.js        getSummary: the gear snapshot of a report
 *   - stores/logGearStore.js         getCasts: the gear of every raider
 *   - services/logcheck/logChannel.js           getFights for title and raid progress. v2 has
 *                                 both, but only with the optional OAuth client
 *                                 and in another shape (raidProgress reads v1's
 *                                 boss/kill/zoneName), so a v2 path would need
 *                                 this one as fallback: two paths for one list
 *   - services/logcheck/logTitles.js  getFights for the list's titles, per version
 *   - services/logcheck/wclGuildSync.js  getGuildReports: the new reports of a
 *                                 server's WCL guild (#922), only on v1
 *   - logLinks.parseReportLink    host + id of a link (also as a static here), no request
 */
// The v1 site a client asks when nobody names one: the classic host the CLA
// port has always read (it serves the fresh/TBC Anniversary reports as well).
// The log check hands the site of the log's version instead
// (services/logcheck/logVersion.js, #746); the other readers are TBC-only and
// keep this one.
const LEGACY_SITE = WCL_LEGACY_SITE;
const SITE_RE = /^https:\/\/[a-z0-9.-]*warcraftlogs\.com$/i;

class WarcraftLogs {
    /**
     * @param {string} [apiKey]
     * @param {{ site?: string }} [opts] the origin of the WCL site whose v1 API
     *   to ask ("https://vanilla.warcraftlogs.com"); LEGACY_SITE without a valid one
     */
    constructor(apiKey = process.env.WARCRAFTLOGS_API_KEY, { site } = {}) {
        if (!apiKey) {
            throw new Error("WARCRAFTLOGS_API_KEY is not set in the environment.");
        }
        this.apiKey = apiKey;
        this.site = SITE_RE.test(String(site || "")) ? String(site) : LEGACY_SITE;
        this.baseUrl = `${this.site}/v1/`;
        this.http = createClient({ service: "Warcraft Logs", baseURL: this.baseUrl, timeout: REQUEST_TIMEOUT_MS });
    }

    /**
     * The host and the report id of a WCL link, `{ host, id }`; a bare id has
     * no host (utils/logcheck/logLinks.js' parseReportLink, #746).
     */
    static parseReportLink(reportUrlOrId) {
        return parseReportLink(reportUrlOrId);
    }

    /** The report id of a WCL link, or the input when it already is an id (see parseReportLink). */
    static parseReportId(reportUrlOrId) {
        return parseReportLink(reportUrlOrId).id;
    }

    async #get(path, params = {}) {
        try {
            const response = await this.http.get(path, { params: { translate: true, api_key: this.apiKey, ...params } });
            return response.data;
        } catch (error) {
            console.error(`WCL API error (${error.status || "?"}) on ${path}:`, error.message);
            throw error;
        }
    }

    /** report/fights/{id} */
    getFights(reportId) {
        return this.#get(`report/fights/${reportId}`);
    }

    /** report/tables/summary/{id} for a time window (one boss pull) */
    getSummary(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/summary/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/casts/{id} for a time window (extra: e.g. { sourceid, filter }) */
    getCasts(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/casts/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/buffs/{id} for a time window (extra: e.g. { sourceid, targetid }) */
    getBuffs(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/buffs/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/debuffs/{id} for a time window */
    getDebuffs(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/debuffs/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/damage-taken/{id} (extra: e.g. { by: "ability", sourceid, options }) */
    getDamageTaken(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/damage-taken/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/damage-done/{id} (extra: e.g. { by: "source", sourceid, abilityid }) */
    getDamageDone(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/damage-done/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/healing/{id} for a time window */
    getHealing(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/healing/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/deaths/{id} for a time window */
    getDeaths(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/deaths/${reportId}`, { start, end, ...extra });
    }

    /** report/tables/interrupts/{id} for a time window */
    getInterrupts(reportId, start, end, extra = {}) {
        return this.#get(`report/tables/interrupts/${reportId}`, { start, end, ...extra });
    }

    /** One page of report/events/{view}/{id} (use nextPageTimestamp for paging). */
    getEvents(reportId, view, start, end, extra = {}) {
        return this.#get(`report/events/${view}/${reportId}`, { start, end, ...extra });
    }

    /**
     * reports/guild/{guild}/{server}/{region} (#922): the reports a WCL guild
     * uploaded, each `{ id, title, owner, start, end, zone }` (ms timestamps),
     * on this client's site. `start`/`end` narrow the window (ms); WCL answers
     * 400 "Invalid guild name/server/region specified." for an unknown guild.
     */
    getGuildReports(guildName, serverName, region, { start, end } = {}) {
        const params = {};
        if (Number.isFinite(start)) params.start = start;
        if (Number.isFinite(end)) params.end = end;
        const path = `reports/guild/${encodeURIComponent(guildName)}/${encodeURIComponent(serverName)}/${encodeURIComponent(region)}`;
        return this.#get(path, params);
    }

    /**
     * Character parses/rankings (per-boss percentiles). They live on the site of
     * the character's game version (#553: fresh for TBC Anniversary, vanilla for
     * Classic Era — the application's version settings name it); fresh without one.
     * @param {{ site?: string }} [opts] the site's origin, "https://<x>.warcraftlogs.com"
     * @returns array of parses (encounterName, spec, percentile, total, reportID, fightID, startTime, ...)
     */
    async getParses(name, realm, region, metric = "dps", { site } = {}) {
        const origin = /^https:\/\/[a-z0-9.-]*warcraftlogs\.com$/i.test(String(site || "")) ? site : "https://fresh.warcraftlogs.com";
        // an absolute URL: axios ignores the classic baseURL for it
        const url = `${origin}/v1/parses/character/${encodeURIComponent(name)}/${encodeURIComponent(realm)}/${encodeURIComponent(region)}`;
        try {
            const response = await this.http.get(url, { params: { metric, api_key: this.apiKey } });
            return response.data;
        } catch (error) {
            console.error(`WCL parses error (${error.status || "?"}) for ${name}-${realm}:`, error.message);
            throw error;
        }
    }

    /**
     * Fetch all events of a view across a window, following nextPageTimestamp.
     *
     * `maxPages` (default 50) bounds the walk. A whole boss fight's cast or
     * damage events run to far more pages than a filtered debuff pull, so a
     * caller that wants them all raises it explicitly rather than getting a
     * silently truncated stream. The result carries `truncated` when the bound
     * was hit, so an analyzer can say its number is a lower estimate.
     *
     * @returns {Array} events, with a `truncated` flag set on the array when cut short
     */
    async getAllEvents(reportId, view, start, end, extra = {}, { maxPages = 50 } = {}) {
        const all = [];
        let cursor = start;
        let truncated = false;
        for (let guard = 0; ; guard++) {
            if (guard >= maxPages) {
                truncated = true;
                break;
            }
            const page = await this.getEvents(reportId, view, cursor, end, extra);
            if (page && Array.isArray(page.events)) all.push(...page.events);
            if (page && page.nextPageTimestamp && page.nextPageTimestamp > cursor) cursor = page.nextPageTimestamp;
            else break;
        }
        if (truncated) all.truncated = true;
        return all;
    }
}

WarcraftLogs.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
WarcraftLogs.LEGACY_SITE = LEGACY_SITE;

module.exports = WarcraftLogs;
