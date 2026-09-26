const { createClient } = require("./httpClient");
const logger = require("../logger.js").child("raidhelper");

// Client for the raid-helper.xyz API (v4 events, raidplan). Every caller gets
// it through utils/raidhelperClient.js, which may hand out a disabled or a
// fixture client with the same method names instead.
//
// Error contract (unchanged by the move to httpClient, #429):
//   - Raid-Helper answers errors with a body — plain text ("Endpoint … not
//     found") or JSON ({ status: "failed", … }) — whatever the HTTP status.
//     The status is therefore not an error by itself: the body is read and
//     judged per method, as it always was.
//   - Reads of the event list (fetchEvents, getAllEvents, getPastEvents,
//     getUserSignUps, getMissingSignUps) reject: with the JSON failure payload
//     as-is when Raid-Helper says `status: "failed"`, else with an Error.
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

// raid-helper.xyz sometimes accepts the connection and then never answers.
// Without a timeout the promise never settles and the admin action that
// triggered it hangs until the reverse proxy answers 504 — that is what made
// "fehlende Raider pingen" appear to do nothing at all. A timeout is not
// retried for the same reason; a 5xx or a dropped connection is (GET only).
const REQUEST_TIMEOUT_MS = 20000;

// the body is judged here, not by axios: keep it as the text Raid-Helper sent
const RAW = { responseType: "text", transformResponse: [(data) => data] };

function unexpected(status, body) {
    return new Error(`Unerwartete Antwort von Raid-Helper (HTTP ${status}): ${String(body || "").slice(0, 200)}`);
}

function hasSignUp(event, userid) {
    return (event.signUps || []).some((signup) => signup.userId === userid && signup.specName !== "Absence");
}

class Raidhelper {
    // opts.serverId lets callers override the raid-helper.xyz server id from the
    // admin-editable settings store (see utils/raidhelperClient.js); apiKey stays
    // env-only since it's a real secret.
    constructor(opts = {}) {
        this.apiKey = process.env.RAIDHELPER_API_KEY;
        this.serverId = opts.serverId || process.env.RAIDHELPER_SERVER_ID;
        this.http = createClient({
            service: "Raid-Helper",
            baseURL: "https://raid-helper.xyz/api/",
            timeout: REQUEST_TIMEOUT_MS,
            retry: { timeouts: false },
        });
    }

    // One request; answers { status, body } for every HTTP status (see the
    // contract above) and throws the ApiError only when no answer came.
    async send(config) {
        try {
            const headers = { Authorization: this.apiKey, ...config.headers };
            const res = await this.http.request({ ...RAW, ...config, headers });
            return { status: res.status, body: res.data };
        } catch (err) {
            if (err && err.kind === "http") return { status: err.status, body: err.data };
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
    // sorted ascending by start time. Shared by every event-list read.
    async fetchEvents(startTimeFilter) {
        const parsed = await this.sendJson(this.getEventOptions(startTimeFilter));
        if (parsed && parsed.status === "failed") throw parsed;
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
        return body;
    }

    async getEvent(eventid) {
        return this.sendJson({ method: "GET", url: `v4/events/${eventid}` });
    }

    async getSetup(raidid) {
        let res;
        try {
            res = await this.send({
                method: "GET",
                url: `raidplan/${raidid}`,
                headers: { StartTimeFilter: Math.floor(Date.now() / 1000), IncludeSignups: true },
            });
        } catch (error) {
            logger.debug(`getSetup(${raidid}) failed, treating as no setup:`, error.message);
            return undefined;
        }
        if (!res.body) return undefined;
        // a raidplan that doesn't exist yet answers a non-JSON body: no setup
        let parsed;
        try {
            parsed = JSON.parse(res.body);
        } catch {
            return undefined;
        }
        if (!parsed) return undefined;
        return { raidid, setup: parsed.slots, startTime: parsed.startTime || parsed.date || parsed.start_time || null };
    }

    // Create a new Raid-Helper event in the given channel.
    // data: { channelId, leaderId, templateId, date (dd-MM-yyyy), time (HH:mm), title, description }
    // Endpoint per raid-helper.xyz API: POST /api/v4/servers/{serverId}/channels/{channelId}/event
    // (the v2 event-creation/signup endpoints have been shut down server-side — they now all
    // 404 with a generic "Endpoint ... not found" regardless of auth, verified live 2026-07-25)
    async createEvent(data) {
        const { channelId, ...body } = data;
        return this.sendJson({
            method: "POST",
            url: `v4/servers/${this.serverId}/channels/${channelId}/event`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(body),
        });
    }
}

Raidhelper.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;

module.exports = Raidhelper;
