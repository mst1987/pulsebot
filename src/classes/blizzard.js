const axios = require("axios");
const wowhead = require("../utils/wowhead");

// Normalize a Blizzard gem stat text for table lookup: lowercase, "&" → "and",
// collapsed whitespace, no trailing period ("+8 Agility" → "+8 agility").
function normalizeGemText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/\s+/g, " ")
        .replace(/\.$/, "")
        .trim();
}

// Stat text → TBC gem cut, for profiles where the API reports gems only as
// display strings (no item reference). Covers the standard uncommon/rare/epic
// cuts and the common metas; resolution to id/icon then goes through Wowhead's
// name search, so a wrong/missing entry degrades to showing the raw stat text
// rather than a wrong gem. Locale is en_GB (the client's fixed API locale).
const TBC_GEM_NAME_BY_TEXT = {
    // red — strength / agility / spell damage / attack power
    "+6 strength": "Bold Blood Garnet",
    "+8 strength": "Bold Living Ruby",
    "+10 strength": "Bold Crimson Spinel",
    "+6 agility": "Delicate Blood Garnet",
    "+8 agility": "Delicate Living Ruby",
    "+10 agility": "Delicate Crimson Spinel",
    "+7 spell damage": "Runed Blood Garnet",
    "+9 spell damage": "Runed Living Ruby",
    "+12 spell damage": "Runed Crimson Spinel",
    "+12 attack power": "Bright Blood Garnet",
    "+16 attack power": "Bright Living Ruby",
    "+20 attack power": "Bright Crimson Spinel",
    // yellow — intellect / crit / hit / resilience / defense
    "+6 intellect": "Brilliant Golden Draenite",
    "+8 intellect": "Brilliant Dawnstone",
    "+10 intellect": "Brilliant Lionseye",
    "+6 critical strike rating": "Smooth Golden Draenite",
    "+8 critical strike rating": "Smooth Dawnstone",
    "+10 critical strike rating": "Smooth Lionseye",
    "+6 hit rating": "Rigid Golden Draenite",
    "+8 hit rating": "Rigid Dawnstone",
    "+10 hit rating": "Rigid Lionseye",
    "+6 spell critical strike rating": "Gleaming Golden Draenite",
    "+8 spell critical strike rating": "Gleaming Dawnstone",
    "+10 spell critical strike rating": "Gleaming Lionseye",
    "+8 spell hit rating": "Great Dawnstone",
    "+10 spell hit rating": "Great Lionseye",
    "+8 resilience rating": "Mystic Dawnstone",
    "+10 resilience rating": "Mystic Lionseye",
    "+8 defense rating": "Thick Dawnstone",
    "+10 defense rating": "Thick Lionseye",
    // blue — stamina / spirit / spell penetration
    "+9 stamina": "Solid Azure Moonstone",
    "+12 stamina": "Solid Star of Elune",
    "+15 stamina": "Solid Empyrean Sapphire",
    "+8 spirit": "Sparkling Star of Elune",
    "+10 spirit": "Sparkling Empyrean Sapphire",
    "+10 spell penetration": "Stormy Star of Elune",
    "+13 spell penetration": "Stormy Empyrean Sapphire",
    // orange hybrids (rare +4/+4, epic +5/+5)
    "+4 strength and +4 critical strike rating": "Inscribed Noble Topaz",
    "+5 strength and +5 critical strike rating": "Inscribed Pyrestone",
    "+4 agility and +4 hit rating": "Glinting Noble Topaz",
    "+5 agility and +5 hit rating": "Glinting Pyrestone",
    "+5 spell damage and +4 spell critical strike rating": "Potent Noble Topaz",
    "+6 spell damage and +5 spell critical strike rating": "Potent Pyrestone",
    "+8 attack power and +4 critical strike rating": "Wicked Noble Topaz",
    "+10 attack power and +5 critical strike rating": "Wicked Pyrestone",
    // purple hybrids
    "+4 strength and +6 stamina": "Sovereign Nightseye",
    "+5 strength and +7 stamina": "Sovereign Shadowsong Amethyst",
    "+4 agility and +6 stamina": "Shifting Nightseye",
    "+5 agility and +7 stamina": "Shifting Shadowsong Amethyst",
    "+5 spell damage and +6 stamina": "Glowing Nightseye",
    "+6 spell damage and +7 stamina": "Glowing Shadowsong Amethyst",
    "+8 attack power and +6 stamina": "Balanced Nightseye",
    // green hybrids
    "+4 critical strike rating and +6 stamina": "Jagged Talasite",
    "+5 critical strike rating and +7 stamina": "Jagged Seaspray Emerald",
    "+4 defense rating and +6 stamina": "Enduring Talasite",
    // metas (unique effect texts)
    "+12 agility and 3% increased critical damage": "Relentless Earthstorm Diamond",
    "+24 attack power and minor run speed increase": "Swift Skyfire Diamond",
    "+12 intellect and chance to restore mana on spellcast": "Insightful Earthstorm Diamond",
    "+18 stamina and 5% stun resistance": "Powerful Earthstorm Diamond",
    "+12 spell critical strike rating and 3% increased critical damage": "Chaotic Skyfire Diamond",
    "+12 spell critical strike rating and 3% increased critical spell damage": "Chaotic Skyfire Diamond",
};

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
     * level, enchants, enchantIds, sockets, iconUrl }.
     *
     * The classic profile API reports socketed gems in TWO possible places, and
     * real Thunderstrike data has shown the `sockets` array to be absent while
     * the gems appear as extra entries in `enchantments[]` (plain stat texts
     * like "+8 Agility" next to the real enchant's "Enchanted: ..." entry). We
     * therefore classify each enchantment entry:
     *   - permanent enchant: slot type PERMANENT, or display starting
     *     "Enchanted:" → goes to `enchants` (display strings) + `enchantIds`
     *     (Blizzard enchantment ids, usable for Wowhead's ?ench= tooltip param)
     *   - gem entry: has a `source_item` (the gem item), a SOCKET-ish slot
     *     type, or a stat text that matches a known TBC gem cut → becomes a
     *     socket entry
     * Socket entries are { type, gemId, gemName, gemIconUrl, gemText }; gem
     * identity resolves in order of trust: explicit item ref from the API →
     * static stat-text → gem-name table (TBC_GEM_NAME_BY_TEXT) + Wowhead
     * name search. Unresolvable gems keep their stat text so the information
     * is never dropped. Icons come from Wowhead (the Blizzard endpoint has no
     * media URLs), like utils/lootImport.js's enrichItemNames — best-effort.
     * Returns null on any problem (not configured, auth failure, 403/404,
     * unknown character, network error) so the caller can fall back to a
     * classic-armory.org link.
     */
    async getEquipment(characterName, opts = {}) {
        const data = await this._getCharacter(characterName, "/equipment", opts);
        if (!data) return null;
        const items = data.equipped_items || [];
        const gear = items.map((it) => {
            const enchants = [];
            const enchantIds = [];
            const sockets = (it.sockets || []).map((s) => ({
                type: (s.socket_type && s.socket_type.type) || "",
                gemId: (s.item && s.item.id) || null,
                gemName: (s.item && s.item.name) || null,
                gemIconUrl: "",
                gemText: s.display_string || "",
            }));
            for (const e of it.enchantments || []) {
                const text = e.display_string || (e.source_item && e.source_item.name) || "";
                if (!text) continue;
                const slotType = (e.enchantment_slot && e.enchantment_slot.type) || "";
                const isPermanent = slotType === "PERMANENT" || /^Enchanted:/i.test(text);
                const looksLikeGem = Boolean(e.source_item)
                    || slotType.includes("SOCKET")
                    || Boolean(TBC_GEM_NAME_BY_TEXT[normalizeGemText(text)]);
                if (!isPermanent && looksLikeGem) {
                    // Gems reported via enchantments only appear when the API
                    // sent no sockets array — don't duplicate existing entries.
                    sockets.push({
                        type: "",
                        gemId: (e.source_item && e.source_item.id) || null,
                        gemName: (e.source_item && e.source_item.name) || null,
                        gemIconUrl: "",
                        gemText: e.display_string || "",
                    });
                } else {
                    enchants.push(text);
                    if (e.enchantment_id) enchantIds.push(e.enchantment_id);
                }
            }
            return {
                slot: (it.slot && it.slot.type) || "",
                itemId: (it.item && it.item.id) || null,
                name: it.name || "",
                quality: (it.quality && it.quality.type) || "",
                level: (it.level && it.level.value) || null,
                enchants,
                enchantIds,
                sockets,
                iconUrl: "",
            };
        });
        // Text-only gems: map the stat text to a known TBC gem cut and resolve
        // its id/icon via Wowhead's name search (cached in utils/wowhead).
        for (const g of gear) {
            for (const s of g.sockets) {
                if (s.gemId || (!s.gemName && !s.gemText)) continue;
                const mappedName = s.gemName || TBC_GEM_NAME_BY_TEXT[normalizeGemText(s.gemText)];
                if (!mappedName) continue;
                const found = await wowhead.findItemByName(mappedName);
                if (found) {
                    s.gemId = found.id;
                    s.gemName = found.name;
                    s.gemIconUrl = found.iconUrl || "";
                }
            }
        }
        const ids = [...new Set([
            ...gear.filter((g) => g.itemId).map((g) => g.itemId),
            ...gear.flatMap((g) => g.sockets.filter((s) => s.gemId && !s.gemIconUrl).map((s) => s.gemId)),
        ])];
        if (ids.length) {
            const lookups = await Promise.all(ids.map((id) => wowhead.lookupItem(id)));
            const byId = new Map(ids.map((id, i) => [id, lookups[i]]));
            for (const g of gear) {
                const found = g.itemId ? byId.get(g.itemId) : null;
                if (found && found.iconUrl) g.iconUrl = found.iconUrl;
                for (const s of g.sockets) {
                    const gem = s.gemId ? byId.get(s.gemId) : null;
                    if (gem && !s.gemIconUrl && gem.iconUrl) s.gemIconUrl = gem.iconUrl;
                    if (gem && !s.gemName) s.gemName = gem.name;
                }
            }
        }
        return gear;
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
