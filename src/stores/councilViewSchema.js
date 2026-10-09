// The shape of a loot-council view (role, tiers, raids, BiS list, version) —
// what the page filters by and the addon gets. Shared by the Loot-Council
// profiles (councilProfilesStore.js, #676) and the old per-category views
// (councilStore.js re-exports it), pure so either store can be mocked alone.
const { ROLE_IDS } = require("../config/councilSpecs");

/** What the page shows for a council nobody set a view for. */
const VIEW_DEFAULTS = Object.freeze({ role: "caster", tiers: [], contents: [], bisTier: "", version: "" });
// "" = every role ("Alle" on the page). Grows with the council's roles (#669:
// tank, melee, ranged); a view stored before that only ever holds caster,
// healer or "", all still valid. An unknown role falls back to the default.
const VIEW_ROLES = [...ROLE_IDS, ""];
const ID_RE = /^[a-z0-9_-]{1,32}$/i;

const idList = (raw) => [...new Set((Array.isArray(raw) ? raw : [])
    .map((v) => String(v || "").trim())
    .filter((v) => ID_RE.test(v)))].slice(0, 32);

/**
 * A view as the page sends it, cleaned: unknown roles fall back to the default,
 * ids are short plain strings, `version` is "" (main version), "all" or an id.
 */
function normalizeView(raw) {
    const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const role = typeof v.role === "string" && VIEW_ROLES.includes(v.role.trim()) ? v.role.trim() : VIEW_DEFAULTS.role;
    const bisTier = String(v.bisTier || "").trim();
    const version = String(v.version || "").trim();
    return {
        role,
        tiers: idList(v.tiers),
        contents: idList(v.contents),
        bisTier: ID_RE.test(bisTier) ? bisTier : "",
        version: ID_RE.test(version) ? version : "",
    };
}

module.exports = { VIEW_DEFAULTS, VIEW_ROLES, normalizeView };
