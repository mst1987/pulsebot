const { createClient } = require("./httpClient");

const TOKEN_TIMEOUT_MS = 10000;
const QUERY_TIMEOUT_MS = 30000;

/**
 * Client for the Warcraft Logs **v2** API (GraphQL, OAuth2 client credentials).
 *
 * The v1 client (`warcraftlogs.js`) stays the workhorse for the whole
 * logcheck; this one exists for the things v1 cannot do cheaply — above all
 * the binned damage/healing series of a fight (`report.graph`), which v1 only
 * offers as a flood of raw events. Everything here is optional: without
 * credentials `isConfigured()` is false and every fetch answers `null`, so the
 * report simply lacks the series instead of failing.
 *
 * Credentials come from the settings store (Einstellungen → Verbindungen →
 * Warcraft Logs), passed in by the caller — never from .env. An API client is
 * created at https://www.warcraftlogs.com/api/clients (client id + secret).
 *
 * Endpoints (same for retail and Classic reports — the v2 API is game-wide,
 * a Classic report code resolves on www just as on classic.):
 *   - token:  POST https://www.warcraftlogs.com/oauth/token
 *             grant_type=client_credentials, HTTP basic auth with id/secret
 *             → { access_token, token_type, expires_in (seconds) }
 *   - client: POST https://www.warcraftlogs.com/api/v2/client
 *             { query, variables }, Authorization: Bearer <token>
 *
 * The schema pieces used, as documented in the official SDL
 * (www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html):
 *
 *   reportData { report(code: String) {
 *     graph(fightIDs: [Int], startTime: Float, endTime: Float,
 *           dataType: GraphDataType, hostilityType: HostilityType,
 *           sourceID: Int, viewBy: ViewType, …): JSON
 *     events(fightIDs: [Int], startTime: Float, endTime: Float,
 *            dataType: EventDataType, hostilityType: HostilityType,
 *            includeResources: Boolean, limit: Int, …)
 *       { data: JSON, nextPageTimestamp: Float }
 *   } }
 *
 *   GraphDataType: Summary | Buffs | Casts | DamageDone | DamageTaken | Deaths |
 *                  Debuffs | Dispels | Healing | Interrupts | Resources |
 *                  Summons | Survivability | Threat
 *   HostilityType: Friendlies | Enemies
 *
 * `graph` answers the JSON the site's own chart is drawn from:
 *   { data: { series: [{ name, guid?, type?, pointStart, pointInterval,
 *                        total, data: [Number, …] }, …] } }
 * where `data[i]` belongs to the absolute report time
 * `pointStart + i * pointInterval` (ms). With `startTime`/`endTime` left out it
 * bins the whole report, so both are always passed. Whether the values are a
 * rate (DPS) or the damage per bin is not stated by the schema; `total` on
 * the series lets the analyzer calibrate that (see fightSeries.js).
 *
 * Boss health does **not** come from `graph`: the `Resources` graph type is
 * built for the site's resource view and its per-actor/ability semantics are
 * undocumented. Events with `includeResources: true` are the documented way —
 * every event then carries `sourceResources`/`targetResources` with
 * `hitPoints`/`maxHitPoints` (the same shape healers.js reads mana from).
 * Fetching the *enemies'* damage-done events of a fight (a boss swings every
 * couple of seconds) gives a boss-HP sample every few seconds from a few
 * hundred events — one page — instead of the tens of thousands of friendly
 * damage events.
 *
 * Error contract: `query()` and `getFightSeries()` never throw. A failure
 * answers `null` and leaves the reason in `lastError`:
 *   { reason: "not_configured" }    no credentials
 *   { reason: "graphql", message }  GraphQL errors (partial data is still returned)
 *   { status, message }             HTTP/network/timeout: status null without an
 *                                   answer, message the error code (ERR_BAD_REQUEST,
 *                                   ECONNABORTED, …) or its text
 * The requests go through classes/httpClient.js, whose ApiError is translated
 * into that shape in `_fail()`. Both POSTs are reads, so a 5xx or a dropped
 * connection is retried; a timeout is not (a report build asks for every
 * boss — three 30-s waits per fight would stall it for many minutes).
 */
class WarcraftLogsV2 {
    /**
     * @param {object} [opts]
     * @param {string} [opts.clientId]
     * @param {string} [opts.clientSecret]
     */
    constructor(opts = {}) {
        this.clientId = String(opts.clientId || "").trim();
        this.clientSecret = String(opts.clientSecret || "").trim();
        this._token = null;
        this._tokenExpiry = 0; // epoch ms
        this.lastError = null;
        this.http = createClient({
            service: "Warcraft Logs v2",
            timeout: QUERY_TIMEOUT_MS,
            retry: { methods: ["post"], timeouts: false },
        });
    }

    /** Whether credentials are present. Without them every fetch answers null. */
    isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }

    get tokenUrl() {
        return "https://www.warcraftlogs.com/oauth/token";
    }

    get apiUrl() {
        return "https://www.warcraftlogs.com/api/v2/client";
    }

    /**
     * Fetch (and cache) a client-credentials access token. Cached until a
     * minute before it expires, then fetched afresh. Throws on auth failure.
     */
    async getToken() {
        if (this._token && Date.now() < this._tokenExpiry) return this._token;
        const res = await this.http.post(this.tokenUrl, "grant_type=client_credentials", {
            auth: { username: this.clientId, password: this.clientSecret },
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: TOKEN_TIMEOUT_MS,
        });
        const token = res && res.data && res.data.access_token;
        if (!token) throw new Error("WCL v2 token response carried no access_token");
        this._token = token;
        const ttl = Number(res.data.expires_in) || 0;
        this._tokenExpiry = Date.now() + Math.max(0, (ttl - 60) * 1000);
        return this._token;
    }

    /**
     * Run one GraphQL query. Returns the `data` object, or null when the
     * client is unconfigured, the request fails, or the response carries
     * GraphQL errors (recorded in `lastError`) — the analyzers treat null as
     * "no series", never as a reason to fail the report.
     *
     * A 401 on the query itself means the cached token is no longer good
     * (revoked, or expired earlier than `expires_in` promised): the token is
     * dropped and the query repeated exactly once with a fresh one. A 401 on
     * the token request is a credentials problem and is not retried.
     */
    async query(query, variables = {}) {
        if (!this.isConfigured()) {
            this.lastError = { reason: "not_configured" };
            return null;
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            let token;
            try {
                token = await this.getToken();
            } catch (err) {
                return this._fail(err);
            }
            try {
                const res = await this.http.post(this.apiUrl, { query, variables }, {
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                });
                const body = res && res.data;
                if (body && Array.isArray(body.errors) && body.errors.length) {
                    this.lastError = { reason: "graphql", message: body.errors.map((e) => e && e.message).filter(Boolean).join("; ") };
                    console.warn(`WCL v2 query errors: ${this.lastError.message}`);
                    return body.data || null;
                }
                this.lastError = null;
                return (body && body.data) || null;
            } catch (err) {
                if (err.status === 401) {
                    // a refused token is useless either way; retry only once
                    this._token = null;
                    this._tokenExpiry = 0;
                    if (attempt === 0) {
                        console.warn("WCL v2 query answered 401 — dropping the cached token and retrying once");
                        continue;
                    }
                }
                return this._fail(err);
            }
        }
        return null;
    }

    /** Translate a failure (ApiError or plain Error) into `lastError` and answer null. */
    _fail(err) {
        const status = err.status || null;
        this.lastError = { status, message: err.code || err.message || "unbekannt" };
        console.warn(`WCL v2 request failed (${status || err.code || err.message})`);
        return null;
    }

    /**
     * The damage-done and healing graphs of one fight, plus the enemies'
     * damage-done events with resources (for boss health) — one request.
     *
     * @param {string} reportId
     * @param {number} fightId
     * @param {number} startTime  absolute report ms
     * @param {number} endTime    absolute report ms
     * @returns {Promise<null | { damage: object|null, healing: object|null, enemyEvents: Array }>}
     */
    async getFightSeries(reportId, fightId, startTime, endTime) {
        const data = await this.query(FIGHT_SERIES_QUERY, { code: reportId, id: fightId, start: startTime, end: endTime });
        const report = data && data.reportData && data.reportData.report;
        if (!report) return null;
        const events = [];
        let page = report.enemyEvents;
        let cursor = startTime;
        for (let guard = 0; page && guard < MAX_EVENT_PAGES; guard++) {
            if (Array.isArray(page.data)) events.push(...page.data);
            const next = page.nextPageTimestamp;
            if (!Number.isFinite(next) || next <= cursor || next >= endTime) break;
            cursor = next;
            const more = await this.query(ENEMY_EVENTS_QUERY, { code: reportId, id: fightId, start: cursor, end: endTime });
            page = more && more.reportData && more.reportData.report && more.reportData.report.enemyEvents;
        }
        return {
            damage: report.damage || null,
            healing: report.healing || null,
            enemyEvents: events,
        };
    }
}

// A boss fight's enemy damage events fit one page of 10 000 by a wide margin;
// the bound only protects against an add-heavy pull running away.
const MAX_EVENT_PAGES = 4;

const FIGHT_SERIES_QUERY = `query FightSeries($code: String!, $id: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    damage: graph(fightIDs: [$id], startTime: $start, endTime: $end, dataType: DamageDone, hostilityType: Friendlies)
    healing: graph(fightIDs: [$id], startTime: $start, endTime: $end, dataType: Healing, hostilityType: Friendlies)
    enemyEvents: events(fightIDs: [$id], startTime: $start, endTime: $end, dataType: DamageDone, hostilityType: Enemies, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}`;

const ENEMY_EVENTS_QUERY = `query EnemyEvents($code: String!, $id: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    enemyEvents: events(fightIDs: [$id], startTime: $start, endTime: $end, dataType: DamageDone, hostilityType: Enemies, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}`;

WarcraftLogsV2.FIGHT_SERIES_QUERY = FIGHT_SERIES_QUERY;
WarcraftLogsV2.ENEMY_EVENTS_QUERY = ENEMY_EVENTS_QUERY;

module.exports = WarcraftLogsV2;
