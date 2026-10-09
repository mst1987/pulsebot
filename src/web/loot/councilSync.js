// The slim council roster the loot-sync tool pulls (GET /api/ingest/council) and
// writes into a Lua file for the in-game addon: who needs how much (the need
// score and its three parts) and what each raider already received. No gear
// details, sim data or URLs - the addon needs none of them.
//
// Format "eventhelper-council" version 1 (one category per answer, filters from
// the query) and version 2 (every Loot-Council category at once, each with its
// stored page view). The sync tool (repo eventhelper-addon) and its addon read
// the same shape: when a field changes, the version grows on both sides
// (docs/loot-import.md, "Council-Daten für das Addon").
//
// Pure: `built` is councilRoster()'s answer, everything else is passed in, so
// the mapping is tested with plain object literals.
const { NEED_WEIGHTS } = require("./lootCouncil");

/**
 * The need weights in % as the addon reads them: drought, share, need. Since
 * #668 the score has a fourth part (tenure) and the weights are the council's
 * own (built.weights); the format stays v1/v2 until #670, so the three known
 * parts go out with their real shares (with the defaults 45/30/10 — the rest,
 * 15, is tenure, which is already inside `need` of every raider).
 */
function weightsPct(built) {
    const shares = (built && built.weights && built.weights.needShares) || NEED_WEIGHTS;
    return {
        drought: Math.round((shares.drought || 0) * 100),
        share: Math.round((shares.share || 0) * 100),
        need: Math.round((shares.need || 0) * 100),
    };
}

const FORMAT = "eventhelper-council";
const VERSION = 1;
// How many received items one raider carries - the newest ones.
const MAX_ITEMS = 25;

/** The token the game's class tables use, keyed by the spelling the data may carry. */
const CLASS_FILES = {
    PRIEST: "PRIEST", MAGE: "MAGE", WARLOCK: "WARLOCK", DRUID: "DRUID", SHAMAN: "SHAMAN", PALADIN: "PALADIN",
    HUNTER: "HUNTER", ROGUE: "ROGUE", WARRIOR: "WARRIOR", DEATHKNIGHT: "DEATHKNIGHT",
    // German names, should a stored class ever be localized.
    PRIESTER: "PRIEST", MAGIER: "MAGE", HEXENMEISTER: "WARLOCK", DRUIDE: "DRUID", SCHAMANE: "SHAMAN",
    PALADINE: "PALADIN", JAEGER: "HUNTER", SCHURKE: "ROGUE", KRIEGER: "WARRIOR",
    TODESRITTER: "DEATHKNIGHT",
};

/** "Priest" / "Death Knight" / "priest" -> "PRIEST" / "DEATHKNIGHT"; "" when unknown. */
function classFileFor(className) {
    const key = String(className || "").toUpperCase().replace(/[\s_-]/g, "");
    return CLASS_FILES[key] || "";
}

const pct = (x) => Math.max(0, Math.min(100, Math.round((Number(x) || 0) * 100)));
const seconds = (ms) => (Number(ms) > 0 ? Math.floor(Number(ms) / 1000) : 0);

function raiderView(row) {
    const bis = row.bis || {};
    const parts = row.needParts || {};
    const items = (row.items || [])
        .slice()
        .sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0))
        .slice(0, MAX_ITEMS)
        .map((it) => ({
            itemId: Number(it.itemId) || 0,
            itemName: it.itemName || "",
            awardedAt: seconds(it.awardedAt),
            boss: it.boss || "",
            reason: it.reasonLabel || it.reason || "",
            event: it.eventLabel || "",
        }));
    return {
        character: row.character,
        classFile: classFileFor(row.className),
        specLabel: row.specLabel || "",
        role: row.role,
        need: pct(row.needScore),
        parts: { drought: pct(parts.drought), share: pct(parts.share), need: pct(parts.need) },
        lootCount: row.lootCount || 0,
        lootTotal: row.lootTotal || 0,
        otherCount: row.otherCount || 0,
        lastAwardAt: seconds(row.lastAwardAt),
        daysSinceLoot: row.daysSinceLoot === null || row.daysSinceLoot === undefined ? -1 : row.daysSinceLoot,
        bis: {
            tier: bis.tier || "",
            source: bis.source || "",
            owned: bis.owned || 0,
            total: bis.total || 0,
            missing: (bis.items || []).filter((i) => !i.owned).map((i) => Number(i.id) || 0),
        },
        items,
    };
}

/**
 * @param {object} built       councilRoster()'s answer ({ rows, avgLootCount, bisTier })
 * @param {object} ctx
 * @param {string} [ctx.categoryId]     the requested category ("" = all)
 * @param {object[]} [ctx.categories]   [{ id, name }] the choice for the sync tool
 * @param {string} [ctx.role]           "" | "caster" | "healer"
 * @param {boolean} [ctx.bisTierDerived] no BiS tier was asked for
 * @param {number} [ctx.now]            ms, for generatedAt
 */
function councilSyncPayload(built, ctx = {}) {
    const categories = (ctx.categories || []).map((c) => ({ id: String(c.id), name: String(c.name || c.id) }));
    const categoryId = ctx.categoryId || "";
    const category = categories.find((c) => c.id === categoryId);
    return {
        format: FORMAT,
        version: VERSION,
        generatedAt: seconds(ctx.now || Date.now()),
        filter: {
            category: categoryId,
            categoryName: category ? category.name : "",
            role: ctx.role || "",
            bisTier: built.bisTier || "",
            bisTierDerived: !!ctx.bisTierDerived,
        },
        categories,
        weights: weightsPct(built),
        avgLootCount: built.avgLootCount || 0,
        raiders: (built.rows || []).map(raiderView),
    };
}

const VERSION_2 = 2;

/**
 * Version 2: every Loot-Council category in one answer, each computed with the
 * category's stored view exactly like the page (web/loot/councilView.js).
 * Raiders carry the v1 fields plus a stable `key` (the character key).
 *
 * @param {object[]} entries  per category: { id, name, opts, built, instances }
 *                            (opts = councilOptsFromQuery()'s answer for the view,
 *                            built = buildCouncilView()'s answer)
 * @param {{ now?: number }} [ctx]
 */
function councilSyncPayloadV2(entries, ctx = {}) {
    return {
        format: FORMAT,
        version: VERSION_2,
        generatedAt: seconds(ctx.now || Date.now()),
        // Top-level like before. A category with its own weighting (#668)
        // can differ; v2 has no per-category weights yet (#670), so this is
        // the first category's, else the defaults.
        weights: weightsPct((entries && entries[0] && entries[0].built) || null),
        categories: (entries || []).map(({ id, name, opts, built, instances }) => ({
            id: String(id),
            name: String(name || id),
            lootSystem: "lootcouncil",
            filter: {
                role: opts.role || "",
                tiers: opts.tierIds || [],
                contents: opts.contentIds || [],
                bisTier: built.bisTier || "",
                bisTierDerived: !opts.bisTier,
                // The character version filter: "" = every version.
                version: opts.charVersion || "",
            },
            instances: instances || [],
            avgLootCount: built.avgLootCount || 0,
            raiders: (built.rows || []).map((row) => ({ key: String(row.key || ""), ...raiderView(row) })),
        })),
    };
}

module.exports = { councilSyncPayload, councilSyncPayloadV2, classFileFor, FORMAT, VERSION, VERSION_2, MAX_ITEMS };
