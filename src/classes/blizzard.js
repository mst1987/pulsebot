const axios = require("axios");

// Blizzard Battle.net API client for reading a character's equipped gear
// (paperdoll) on the WoW Classic Anniversary realms (default: Thunderstrike EU,
// namespace profile-classicann-eu — confirmed correct for the Anniversary realms;
// the plain profile-classic-<region> namespace resolves to a different Classic
// line and can return a wrong-era character/gear).
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
        // An explicit namespace (from config/env) always wins; otherwise it is
        // derived from the effective region so a per-call region override still
        // works. `this.namespace` is the resolved default for the instance region.
        this._namespaceExplicit = Boolean(opts.namespace);
        this.namespace = opts.namespace || `profile-classicann-${this.region}`;
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

    // Resolve the effective { region, realm, namespace, host } for a call,
    // honouring per-call overrides then the instance config. The namespace is
    // configurable on purpose: the correct one for the Anniversary realms is not
    // officially documented (community reports mention profile-classic vs
    // profile-classicann vs profile-classic1x), and the wrong one can even return
    // a same-named character from a different Classic line (→ wrong-era gear).
    _resolve(opts = {}) {
        const region = (opts.region || this.region || "eu").toLowerCase();
        const realm = (opts.realmSlug || this.realmSlug || "").toLowerCase();
        const namespace = opts.namespace
            || (this._namespaceExplicit ? this.namespace : `profile-classicann-${region}`);
        return { region, realm, namespace, host: `https://${region}.api.blizzard.com` };
    }

    // Authenticated GET against a character profile sub-path (e.g. "" or
    // "/equipment"). Returns res.data, or null on any failure (records lastError).
    async _getCharacter(characterName, subPath, opts = {}) {
        if (!this.isConfigured()) { this.lastError = { reason: "not_configured" }; return null; }
        if (!characterName) { this.lastError = { reason: "no_name" }; return null; }
        const { realm, namespace, host } = this._resolve(opts);
        const name = encodeURIComponent(String(characterName).trim().toLowerCase());
        const url = `${host}/profile/wow/character/${encodeURIComponent(realm)}/${name}${subPath}`;
        try {
            const token = await this.getToken();
            const res = await axios.get(url, {
                params: { namespace, locale: this.locale },
                headers: { Authorization: `Bearer ${token}` },
                timeout: 12000,
            });
            this.lastError = null;
            return res.data;
        } catch (err) {
            const status = err.response && err.response.status;
            this.lastError = { status: status || null, message: (err.code || err.message || "unbekannt"), namespace };
            console.warn(
                `Blizzard profile lookup failed for ${characterName}@${realm} [${namespace}]${subPath} (${status || err.code || err.message}) — falling back.`
            );
            return null;
        }
    }

    /**
     * A character's equipped items, normalized to { slot, itemId, name, quality,
     * level, enchants, gems, emptySockets }. `enchants`/`gems` are display strings;
     * `emptySockets` counts sockets without a gem. Returns null on any problem
     * (not configured, auth failure, 403/404, empty/unknown character, network
     * error) so the caller can fall back to a classic-armory.org link.
     */
    async getEquipment(characterName, opts = {}) {
        const data = await this._getCharacter(characterName, "/equipment", opts);
        if (!data) return null;
        const items = data.equipped_items || [];
        return items.map((it) => {
            const sockets = it.sockets || [];
            return {
                slot: (it.slot && it.slot.type) || "",
                itemId: (it.item && it.item.id) || null,
                name: it.name || "",
                quality: (it.quality && it.quality.type) || "",
                level: (it.level && it.level.value) || null,
                enchants: (it.enchantments || [])
                    .map((e) => e.display_string || (e.source_item && e.source_item.name) || "")
                    .filter(Boolean),
                gems: sockets
                    .map((s) => (s.item && s.item.name) || "")
                    .filter(Boolean),
                emptySockets: sockets.filter((s) => !s.item).length,
            };
        });
    }

    /**
     * Character summary for diagnostics: { name, realm, level, itemLevel,
     * lastLogin (epoch ms), className, faction, namespace }. Lets the UI show
     * whether the profile data is the right character and how fresh it is (a
     * level 60/80 result on a level-70 TBC char reveals a wrong-namespace hit).
     * Returns null on failure.
     */
    async getCharacterSummary(characterName, opts = {}) {
        const data = await this._getCharacter(characterName, "", opts);
        if (!data) return null;
        return {
            name: data.name || characterName,
            realm: (data.realm && data.realm.name) || "",
            level: data.level || null,
            itemLevel: (data.average_item_level ?? data.equipped_item_level) || null,
            lastLogin: data.last_login_timestamp || null,
            className: (data.character_class && data.character_class.name) || "",
            faction: (data.faction && data.faction.name) || "",
            namespace: this._resolve(opts).namespace,
        };
    }
}

module.exports = Blizzard;
