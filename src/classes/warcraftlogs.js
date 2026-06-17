const axios = require("axios");
const agent = require("../utils/httpAgent");

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
 */
class WarcraftLogs {
    constructor(apiKey = process.env.WARCRAFTLOGS_API_KEY) {
        if (!apiKey) {
            throw new Error("WARCRAFTLOGS_API_KEY is not set in the environment.");
        }
        this.apiKey = apiKey;
        // CLA always targets the classic v1 host regardless of fresh/tbc/classic reports.
        this.baseUrl = "https://classic.warcraftlogs.com/v1/";
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
        const url = `${this.baseUrl}${path}`;
        try {
            const response = await axios.get(url, {
                params: { translate: true, api_key: this.apiKey, ...params },
                httpsAgent: agent,
            });
            return response.data;
        } catch (error) {
            const status = error.response ? error.response.status : "?";
            console.error(`WCL API error (${status}) on ${path}:`, error.message);
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

    /** One page of report/events/{view}/{id} (use nextPageTimestamp for paging). */
    getEvents(reportId, view, start, end, extra = {}) {
        return this.#get(`report/events/${view}/${reportId}`, { start, end, ...extra });
    }

    /**
     * Character parses/rankings (per-boss percentiles). Lives on the fresh host.
     * @returns array of parses (encounterName, spec, percentile, total, reportID, fightID, startTime, ...)
     */
    async getParses(name, realm, region, metric = "dps") {
        const url = `https://fresh.warcraftlogs.com/v1/parses/character/${encodeURIComponent(name)}/${encodeURIComponent(realm)}/${encodeURIComponent(region)}`;
        try {
            const response = await axios.get(url, {
                params: { metric, api_key: this.apiKey },
                httpsAgent: agent,
            });
            return response.data;
        } catch (error) {
            const status = error.response ? error.response.status : "?";
            console.error(`WCL parses error (${status}) for ${name}-${realm}:`, error.message);
            throw error;
        }
    }

    /** Fetch all events of a view across a window, following nextPageTimestamp. */
    async getAllEvents(reportId, view, start, end, extra = {}) {
        const all = [];
        let cursor = start;
        for (let guard = 0; guard < 50; guard++) {
            const page = await this.getEvents(reportId, view, cursor, end, extra);
            if (page && Array.isArray(page.events)) all.push(...page.events);
            if (page && page.nextPageTimestamp && page.nextPageTimestamp > cursor) cursor = page.nextPageTimestamp;
            else break;
        }
        return all;
    }
}

module.exports = WarcraftLogs;
