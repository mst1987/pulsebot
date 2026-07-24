const axios = require("axios");

// Blizzard Battle.net API client for reading a character's equipped gear
// (paperdoll) on the WoW Classic progression realms (default: Thunderstrike EU,
// namespace profile-classic-eu).
//
// IMPORTANT: the Classic profile API is only partially available. Depending on
// the realm/character, the equipment endpoint may return 403/404 or empty data
// (freshly created characters in particular). Every read therefore degrades
// gracefully: getEquipment() returns null on any failure so callers can fall
// back to a plain classic-armory.org link instead of showing an error.
//
// Credentials (client id/secret) are passed in by the web layer from the editable
// settings store, so they can be configured from the admin menu (kept out of
// .env on purpose). env vars BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET act as a
// fallback bootstrap.
class Blizzard {
    /**
     * @param {object} opts
     * @param {string} opts.clientId     Battle.net API client id
     * @param {string} opts.clientSecret Battle.net API client secret
     * @param {string} [opts.region]     "eu" (default) / "us" / …
     * @param {string} [opts.realmSlug]  connected-realm slug, lowercase (default "thunderstrike")
     * @param {string} [opts.namespace]  profile namespace (default "profile-classic-<region>")
     * @param {string} [opts.locale]     API locale (default "en_GB")
     */
    constructor(opts = {}) {
        this.clientId = opts.clientId || process.env.BLIZZARD_CLIENT_ID || "";
        this.clientSecret = opts.clientSecret || process.env.BLIZZARD_CLIENT_SECRET || "";
        this.region = (opts.region || process.env.BLIZZARD_REGION || "eu").toLowerCase();
        this.realmSlug = (opts.realmSlug || process.env.BLIZZARD_REALM || "thunderstrike").toLowerCase();
        this.namespace = opts.namespace || `profile-classic-${this.region}`;
        this.locale = opts.locale || "en_GB";
        this._token = null;
        this._tokenExpiry = 0; // epoch ms
        // Reason the last getEquipment() returned null, for UI diagnostics:
        // { status, message } or { reason: "not_configured" | "no_name" }.
        this.lastError = null;
    }

    /** Whether credentials are present. Without them getEquipment() short-circuits to null. */
    isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }

    /** The oauth token host is region-agnostic (except CN, which we don't target). */
    get tokenUrl() {
        return "https://oauth.battle.net/token";
    }

    /** Regional Game Data / Profile API host, e.g. https://eu.api.blizzard.com */
    get apiHost() {
        return `https://${this.region}.api.blizzard.com`;
    }

    /**
     * Fetch (and cache) a client-credentials access token. Cached until ~1 min
     * before expiry. Returns the token string, or throws on auth failure.
     */
    async getToken() {
        if (this._token && Date.now() < this._tokenExpiry) return this._token;
        const res = await axios.post(
            this.tokenUrl,
            "grant_type=client_credentials",
            {
                auth: { username: this.clientId, password: this.clientSecret },
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout: 10000,
            }
        );
        this._token = res.data.access_token;
        // expires_in is seconds; refresh a minute early to avoid edge expiry.
        const ttl = Number(res.data.expires_in) || 0;
        this._tokenExpiry = Date.now() + Math.max(0, (ttl - 60) * 1000);
        return this._token;
    }

    /**
     * A character's equipped items, normalized to { slot, itemId, name, quality,
     * level }. Returns null on any problem (not configured, auth failure, 403/404,
     * empty/unknown character, network error) so the caller can fall back to a
     * classic-armory.org link. Character/realm names are lowercased for the API.
     */
    async getEquipment(characterName, opts = {}) {
        if (!this.isConfigured()) { this.lastError = { reason: "not_configured" }; return null; }
        if (!characterName) { this.lastError = { reason: "no_name" }; return null; }
        const realm = (opts.realmSlug || this.realmSlug || "").toLowerCase();
        const region = (opts.region || this.region || "eu").toLowerCase();
        const namespace = opts.namespace || `profile-classic-${region}`;
        const name = encodeURIComponent(String(characterName).trim().toLowerCase());
        const url = `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(realm)}/${name}/equipment`;
        try {
            const token = await this.getToken();
            const res = await axios.get(url, {
                params: { namespace, locale: this.locale },
                headers: { Authorization: `Bearer ${token}` },
                timeout: 12000,
            });
            this.lastError = null;
            const items = (res.data && res.data.equipped_items) || [];
            return items.map((it) => ({
                slot: (it.slot && it.slot.type) || "",
                itemId: (it.item && it.item.id) || null,
                name: it.name || "",
                quality: (it.quality && it.quality.type) || "",
                level: (it.level && it.level.value) || null,
            }));
        } catch (err) {
            const status = err.response && err.response.status;
            this.lastError = { status: status || null, message: (err.code || err.message || "unbekannt") };
            // 403/404 are the documented "no profile data for this character/realm"
            // responses — expected, not an outage. Log briefly and fall back.
            console.warn(
                `Blizzard equipment lookup failed for ${characterName}@${realm} (${status || err.code || err.message}) — falling back to armory link.`
            );
            return null;
        }
    }
}

module.exports = Blizzard;
