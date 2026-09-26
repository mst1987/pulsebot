const { createClient } = require("./httpClient");

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
 *                                 read as v1 answers throughout the analyzers
 *   - commands/apply/applyModal   getParses (character rankings on the fresh
 *                                 host, analyzeApplicant), then report.js
 *   - services/characters/characterInfo.js        getSummary: the gear snapshot of a report
 *   - stores/logGearStore.js         getCasts: the gear of every raider
 *   - web/logChannel.js           getFights for title and raid progress. v2 has
 *                                 both, but only with the optional OAuth client
 *                                 and in another shape (raidProgress reads v1's
 *                                 boss/kill/zoneName), so a v2 path would need
 *                                 this one as fallback: two paths for one list
 *   - commands/logcheck/logcheck  only the static parseReportId(), no request
 */
class WarcraftLogs {
    constructor(apiKey = process.env.WARCRAFTLOGS_API_KEY) {
        if (!apiKey) {
            throw new Error("WARCRAFTLOGS_API_KEY is not set in the environment.");
        }
        this.apiKey = apiKey;
        // CLA always targets the classic v1 host regardless of fresh/tbc/classic reports.
        this.baseUrl = "https://classic.warcraftlogs.com/v1/";
        this.http = createClient({ service: "Warcraft Logs", baseURL: this.baseUrl, timeout: REQUEST_TIMEOUT_MS });
    }

    /**
     * Extract the report id from a full WCL url or return the input if it already is an id.
     */
    static parseReportId(reportUrlOrId) {
        if (!reportUrlOrId) return "";
        let input = reportUrlOrId.toString().trim().replace(".cn/", ".com/");
        const marker = "warcraftlogs.com/reports/";
        if (input.indexOf(marker) > -1) {
            input = input.split(marker)[1];
        }
        // strip query string and #fragment (fight=, type=, ...)
        return input.split("#")[0].split("?")[0].split("/")[0];
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
     * Character parses/rankings (per-boss percentiles). Lives on the fresh host.
     * @returns array of parses (encounterName, spec, percentile, total, reportID, fightID, startTime, ...)
     */
    async getParses(name, realm, region, metric = "dps") {
        // an absolute URL: axios ignores the classic baseURL for it
        const url = `https://fresh.warcraftlogs.com/v1/parses/character/${encodeURIComponent(name)}/${encodeURIComponent(realm)}/${encodeURIComponent(region)}`;
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

module.exports = WarcraftLogs;
