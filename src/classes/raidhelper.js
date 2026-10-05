const { createClient } = require("./httpClient");
const logger = require("../logger.js").child("raidhelper");
const budget = require("../utils/raidhelper/budget");

// Client for the raid-helper.xyz API (v4 events, raidplan). Every caller gets
// it through utils/raidhelper/client.js, which may hand out a disabled or a
// fixture client with the same method names instead.
//
// Error contract (unchanged by the move to httpClient, #429):
//   - Raid-Helper answers errors with a body — plain text ("Endpoint … not
//     found") or JSON ({ status: "failed", … }) — whatever the HTTP status.
//     The status is therefore not an error by itself: the body is read and
//     judged per method, as it always was.
//   - Reads of the event list (fetchEvents, getAllEvents, getPastEvents,
//     getUserSignUps, getMissingSignUps) reject with an Error. When Raid-Helper
//     says `status: "failed"`, its message carries the `reason` and the
//     payload's fields are copied onto it — the bare payload used to be thrown,
//     had no message, and every page showed its generic "konnten nicht geladen
//     werden" instead of, say, the rate limit.
//   - getTemplates never rejects; it answers [] on any failure.
//   - getEvent resolves the parsed body (also a failure payload), rejects on a
//     non-JSON body or a transport error.
//   - getSetup never rejects; no raidplan, a non-JSON body or any transport
//     error resolve undefined ("no setup").
//   - signUp resolves the raw response text; createEvent resolves the parsed
//     body (a failure payload included) and rejects on a non-JSON body. Both
//     reject on a transport error and are never retried (not idempotent).
//   - A transport error is an ApiError (classes/httpClient.js): network, or a
//     timeout after REQUEST_TIMEOUT_MS.
//   - Every request first passes the request budget (utils/raidhelper/
//     budget.js). Past it nothing is sent and send() throws an Error of code
//     "raidhelper_budget" — each method then answers exactly as it does for a
//     transport error (getSetup: undefined, getTemplates: [], the rest reject).
//
// Two modes (#606). The pages never ask Raid-Helper for the event list
// themselves: utils/raidhelper/client.js hands out a client with
// `opts.snapshot`, a function (sinceSeconds) -> events that answers every list
// read (fetchEvents and everything built on it) from the list the sync job
// (services/events/raidhelperSync.js) last stored; it throws when there is no
// list yet. Only the sync job and explicit admin actions get a live client
// (no `snapshot`). `opts.cacheMs` keeps getSetup/getEvent answers that long per
// id, and `opts.onWrite` is called after a successful createEvent/signUp, so
// the sync can pick the change up right away.

// raid-helper.xyz sometimes accepts the connection and then never answers.
// Without a timeout the promise never settles and the admin action that
// triggered it hangs until the reverse proxy answers 504 — that is what made
// "fehlende Raider pingen" appear to do nothing at all. A timeout is not
// retried for the same reason; a 5xx or a dropped connection is (GET only).
const { RAIDHELPER_REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS } = require("../config/constants.js");

// the body is judged here, not by axios: keep it as the text Raid-Helper sent
const RAW = { responseType: "text", transformResponse: [(data) => data] };

function unexpected(status, body) {
    return new Error(`Unerwartete Antwort von Raid-Helper (HTTP ${status}): ${String(body || "").slice(0, 200)}`);
}

// A `status: "failed"` payload as an Error that says why (see the contract above).
function failure(parsed) {
    const reason = String(parsed.reason || parsed.message || "").trim();
    const error = new Error(reason ? `Raid-Helper: ${reason}` : "Raid-Helper hat die Anfrage abgelehnt.");
    return Object.assign(error, parsed, { message: error.message });
}

// getSetup/getEvent answers per id, for clients with `cacheMs` (see above).
const singleCache = new Map(); // "setup:<id>" | "event:<id>" -> { at, value }

function hasSignUp(event, userid) {
    return (event.signUps || []).some((signup) => signup.userId === userid && signup.specName !== "Absence");
}

class Raidhelper {
    // opts.serverId lets callers override the raid-helper.xyz server id from the
    // admin-editable settings store (see utils/raidhelper/client.js); apiKey stays
    // env-only since it's a real secret.
    constructor(opts = {}) {
        this.apiKey = process.env.RAIDHELPER_API_KEY;
        this.serverId = opts.serverId || process.env.RAIDHELPER_SERVER_ID;
        this.snapshot = typeof opts.snapshot === "function" ? opts.snapshot : null;
        this.cacheMs = Number(opts.cacheMs) || 0;
        this.onWrite = typeof opts.onWrite === "function" ? opts.onWrite : null;
        this.http = createClient({
            service: "Raid-Helper",
            baseURL: "https://raid-helper.xyz/api/",
            timeout: REQUEST_TIMEOUT_MS,
            retry: { timeouts: false },
        });
        // every attempt that leaves counts against the budget, a retry too
        this.http.interceptors.request.use((config) => {
            budget.record();
            return config;
        });
    }

    // One request; answers { status, body } for every HTTP status (see the
    // contract above) and throws the ApiError only when no answer came — or
    // the budget's refusal, before anything is sent.
    async send(config) {
        budget.check(budget.priorityFor(config.method));
        try {
            const headers = { Authorization: this.apiKey, ...config.headers };
            const res = await this.http.request({ ...RAW, ...config, headers });
            return { status: res.status, body: res.data };
        } catch (err) {
            if (err && err.kind === "http") {
                if (err.status === 429) budget.noteRateLimited(err.data);
                return { status: err.status, body: err.data };
            }
            throw err;
        }
    }

    async sendJson(config) {
        const { status, body } = await this.send(config);
        try {
            return JSON.parse(body);
        } catch {
            throw unexpected(status, body);
        }
    }

    getEventOptions(timestamp) {
        return {
            method: "GET",
            url: `v4/servers/${this.serverId}/events`,
            headers: { StartTimeFilter: timestamp, IncludeSignups: true },
        };
    }

    // The server's events with a StartTimeFilter lower bound (unix seconds),
    // sorted ascending by start time. Shared by every event-list read — from
    // the synced list when this client has a `snapshot`, else live.
    async fetchEvents(startTimeFilter) {
        if (this.snapshot) return this.snapshot(Math.floor(startTimeFilter) || Math.floor(Date.now() / 1000));
        const parsed = await this.sendJson(this.getEventOptions(startTimeFilter));
        if (parsed && parsed.status === "failed") throw failure(parsed);
        if (!parsed || !Array.isArray(parsed.postedEvents)) throw new Error("Raid-Helper lieferte keine Events.");
        return parsed.postedEvents.sort((a, b) => a.startTime - b.startTime);
    }

    async getAllEvents() {
        return this.fetchEvents(Math.floor(Date.now() / 1000));
    }

    // Events that have already started, newest first. Raid-Helper's StartTimeFilter
    // is only a LOWER bound (there is no documented upper-bound header on v4), so we
    // ask for everything since `sinceSeconds` and drop what is still upcoming here.
    async getPastEvents(sinceSeconds) {
        const now = Math.floor(Date.now() / 1000);
        const events = await this.fetchEvents(Math.floor(sinceSeconds) || now);
        return events
            .filter((event) => Number(event.startTime) <= now)
            .sort((a, b) => b.startTime - a.startTime);
    }

    // Derive the distinct templates the server actually uses from its events.
    // Raid-Helper exposes no "list templates" endpoint, so we read the already
    // available events (v4 endpoint) and collapse them to { id, name } by
    // templateId. Returns [] on any API failure so callers can degrade cleanly.
    async getTemplates() {
        let events;
        try {
            events = await this.getAllEvents();
        } catch (error) {
            logger.debug("getTemplates: getAllEvents failed, degrading to []:", error.message);
            return [];
        }
        const byId = new Map();
        for (const event of events || []) {
            const hasId = event && event.templateId !== null && event.templateId !== undefined;
            const id = hasId ? String(event.templateId).trim() : "";
            if (!id || byId.has(id)) continue;
            const name = String(event.templateName || event.templateTitle || event.title || "").trim();
            byId.set(id, { id, name });
        }
        return [...byId.values()].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    }

    // Upcoming events the user signed up for (an "Absence" is no signup).
    async getUserSignUps(userid) {
        const events = await this.getAllEvents();
        return events.filter((event) => hasSignUp(event, userid));
    }

    // Channel ids of the upcoming events the user has not signed up for.
    async getMissingSignUps(userid) {
        const events = await this.getAllEvents();
        return events.filter((event) => !hasSignUp(event, userid)).map((event) => event.channelId);
    }

    async signUpToRaid(raidid, signUps, userid) {
        // one after the other: Raid-Helper applies them in order
        for (const signUp of signUps) {
            await this.signUp(raidid, signUp, userid);
        }
    }

    async signUp(raidid, classes, userid) {
        const { body } = await this.send({
            method: "POST",
            url: `v4/events/${raidid}/signups`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ userId: userid, className: classes.className, specName: classes.specName }),
        });
        this.wrote(raidid);
        return body;
    }

    // The cached answer for `key` while it is younger than `cacheMs`, else undefined.
    cached(key) {
        const hit = this.cacheMs > 0 && singleCache.get(key);
        return hit && Date.now() - hit.at < this.cacheMs ? hit : undefined;
    }

    remember(key, value) {
        if (this.cacheMs > 0) singleCache.set(key, { at: Date.now(), value });
        return value;
    }

    // After a write: that event's cached answers are outdated, and the sync may want to know.
    wrote(eventId) {
        if (eventId) {
            singleCache.delete(`event:${eventId}`);
            singleCache.delete(`setup:${eventId}`);
        }
        if (this.onWrite) this.onWrite();
    }

    async getEvent(eventid) {
        const hit = this.cached(`event:${eventid}`);
        if (hit) return hit.value;
        const event = await this.sendJson({ method: "GET", url: `v4/events/${eventid}` });
        return event && event.status === "failed" ? event : this.remember(`event:${eventid}`, event);
    }

    async getSetup(raidid) {
        const hit = this.cached(`setup:${raidid}`);
        if (hit) return hit.value;
        const { value, keep } = await this.fetchSetup(raidid);
        return keep ? this.remember(`setup:${raidid}`, value) : value;
    }

    // getSetup without the cache: { value, keep } — `keep` is false for a
    // refused or failed request (and a rate-limit answer), which must not be
    // remembered as "no setup".
    async fetchSetup(raidid) {
        let res;
        try {
            res = await this.send({
                method: "GET",
                url: `raidplan/${raidid}`,
                headers: { StartTimeFilter: Math.floor(Date.now() / 1000), IncludeSignups: true },
            });
        } catch (error) {
            logger.debug(`getSetup(${raidid}) failed, treating as no setup:`, error.message);
            return { value: undefined, keep: false };
        }
        const keep = res.status !== 429 && !(res.status >= 500);
        if (!res.body) return { value: undefined, keep };
        // a raidplan that doesn't exist yet answers a non-JSON body: no setup
        let parsed;
        try {
            parsed = JSON.parse(res.body);
        } catch {
            return { value: undefined, keep };
        }
        if (!parsed) return { value: undefined, keep };
        if (parsed.status === "failed") return { value: undefined, keep: false };
        return { value: { raidid, setup: parsed.slots, startTime: parsed.startTime || parsed.date || parsed.start_time || null }, keep };
    }

    // Create a new Raid-Helper event in the given channel.
    // data: { channelId, leaderId, templateId, date (dd-MM-yyyy), time (HH:mm), title, description }
    // Endpoint per raid-helper.xyz API: POST /api/v4/servers/{serverId}/channels/{channelId}/event
    // (the v2 event-creation/signup endpoints have been shut down server-side — they now all
    // 404 with a generic "Endpoint ... not found" regardless of auth, verified live 2026-07-25)
    async createEvent(data) {
        const { channelId, ...body } = data;
        const result = await this.sendJson({
            method: "POST",
            url: `v4/servers/${this.serverId}/channels/${channelId}/event`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(body),
        });
        if (!(result && result.status === "failed")) this.wrote(null);
        return result;
    }
}

Raidhelper.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
/** Test-only: forget the cached getSetup/getEvent answers. */
Raidhelper._resetCacheForTests = () => singleCache.clear();

module.exports = Raidhelper;
