const { createClient } = require("./httpClient");

// Twitch Helix client for the stream announcements (docs/twitch.md).
//
// App access token (client credentials) only: GET /streams needs no user. The
// credentials live in `config.twitch` (Einstellungen → Verbindungen, full admins
// only), TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET in the env are the fallback.
//
// Failure contract: getStreams() THROWS an ApiError on anything but a clean answer
// (timeout, network, 429, 5xx, a second 401). The caller must read that as
// "unknown", never as "everybody is offline" - only a clean answer says who is live.
// The secret and the token never reach a log line: errors carry the status only.

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const STREAMS_URL = "https://api.twitch.tv/helix/streams";
const HTTP_TIMEOUT_MS = 10000;
/** Twitch's limit per request (user_login and first). */
const LOGINS_PER_REQUEST = 100;

class Twitch {
    /**
     * @param {object} [opts]
     * @param {string} [opts.clientId]     defaults to TWITCH_CLIENT_ID
     * @param {string} [opts.clientSecret] defaults to TWITCH_CLIENT_SECRET
     */
    constructor(opts = {}) {
        this.clientId = opts.clientId || process.env.TWITCH_CLIENT_ID || "";
        this.clientSecret = opts.clientSecret || process.env.TWITCH_CLIENT_SECRET || "";
        this._token = null;
        this._tokenExpiry = 0; // epoch ms
        this._tokenRequest = null; // the token request in flight, shared by parallel callers
        this.http = createClient({ service: "Twitch", timeout: HTTP_TIMEOUT_MS, retry: { retries: 1, methods: ["get", "post"] } });
    }

    /** Whether credentials are present. Without them the job does nothing. */
    isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }

    /** A cached app access token, valid until a minute before it expires. */
    async getToken() {
        if (this._token && Date.now() < this._tokenExpiry) return this._token;
        if (!this._tokenRequest) {
            this._tokenRequest = this._requestToken().finally(() => { this._tokenRequest = null; });
        }
        return this._tokenRequest;
    }

    async _requestToken() {
        const form = new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: "client_credentials",
        });
        const res = await this.http.post(TOKEN_URL, form.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        this._token = res.data.access_token;
        const ttl = Number(res.data.expires_in) || 0;
        this._tokenExpiry = Date.now() + Math.max(0, (ttl - 60) * 1000);
        return this._token;
    }

    _forgetToken() {
        this._token = null;
        this._tokenExpiry = 0;
    }

    async _getStreamsOnce(logins) {
        const query = [...logins.map((login) => `user_login=${encodeURIComponent(login)}`), `first=${LOGINS_PER_REQUEST}`].join("&");
        const token = await this.getToken();
        const res = await this.http.get(`${STREAMS_URL}?${query}`, {
            headers: { Authorization: `Bearer ${token}`, "Client-Id": this.clientId },
        });
        return Array.isArray(res.data && res.data.data) ? res.data.data : [];
    }

    /**
     * The live streams of `logins`, in chunks of 100; a login without a stream is
     * simply not in the answer. A 401 fetches a new token once and asks again.
     * @param {string[]} logins lowercase Twitch logins
     * @returns {Promise<object[]>} Twitch's stream objects
     * @throws {import("./httpClient").ApiError} on anything but a clean answer
     */
    async getStreams(logins) {
        const unique = [...new Set(logins || [])];
        const out = [];
        for (let i = 0; i < unique.length; i += LOGINS_PER_REQUEST) {
            const chunk = unique.slice(i, i + LOGINS_PER_REQUEST);
            try {
                out.push(...await this._getStreamsOnce(chunk));
            } catch (e) {
                if (!e || e.status !== 401) throw e;
                this._forgetToken();
                out.push(...await this._getStreamsOnce(chunk));
            }
        }
        return out;
    }
}

module.exports = Twitch;
module.exports.LOGINS_PER_REQUEST = LOGINS_PER_REQUEST;
