// A character's live Blizzard data for the character page (GET /api/history/char):
// the profile summary and the equipped gear. The two requests go out side by
// side (they used to run one after the other), and an answer with gear is kept
// for GEAR_CACHE_TTL_MS per character and realm, so opening the same character
// again — the roster, the loot council and the history all link there — does
// not ask Blizzard again. A failed answer is never kept: a fixed realm or
// namespace in the settings shows at once.

const GEAR_CACHE_TTL_MS = 10 * 60 * 1000;
// Looked up by key, never walked, so a plain cap (oldest out) is enough.
const GEAR_CACHE_MAX = 300;
const cache = new Map(); // key -> { at, value }

/** The cache key: the same name on another realm, region or namespace is another character. */
function cacheKey(name, bz) {
    return [bz.region, bz.realmSlug, bz.namespace, String(name || "").trim().toLowerCase()].join("|");
}

/**
 * Summary and gear of one character.
 * @param {{ client: object, region?: string, realmSlug?: string, namespace?: string }} bz what
 *   versionSettings.blizzardFor() returns, with a client
 * @param {string} name
 * @returns {Promise<{ charSummary: object|null, gear: object[]|null, error: object|null }>} `error`
 *   is the client's lastError of the gear request (null when the gear came back)
 */
async function loadCharGear(bz, name, now = Date.now()) {
    const key = cacheKey(name, bz);
    const hit = cache.get(key);
    if (hit && now - hit.at < GEAR_CACHE_TTL_MS) return hit.value;
    const client = bz.client;
    // Both requests write the client's lastError: read it the moment the gear request ends.
    const [charSummary, equipment] = await Promise.all([
        client.getCharacterSummary(name),
        client.getEquipment(name).then((gear) => ({ gear, error: gear === null ? (client.lastError || {}) : null })),
    ]);
    const value = { charSummary, gear: equipment.gear, error: equipment.error };
    if (value.gear !== null) {
        cache.delete(key);
        cache.set(key, { at: now, value });
        if (cache.size > GEAR_CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return value;
}

/** Test-only: forget every kept answer. */
function _resetForTests() {
    cache.clear();
}

module.exports = { loadCharGear, GEAR_CACHE_TTL_MS, GEAR_CACHE_MAX, _resetForTests };
