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

const FORMAT = "eventhelper-council";
const VERSION = 1;
// How many received items one raider carries - the newest ones.
const MAX_ITEMS = 25;

// The roles versions 1 and 2 know. The council has had tank, melee and ranged
// raiders since #669, but an addon reading v1/v2 has a fixed role set (caster,
// healer) and must not be handed a role it cannot place - so both formats
// leave those raiders out and report a view on one of the new roles as ""
// (every role). Version 3 (#670) carries them; until then they exist on the
// page only. The need score of the raiders who remain is still measured against
// the whole field the view selects, exactly like the page shows it.
const LEGACY_ROLES = new Set(["caster", "healer"]);

/** The rows an old addon can place: casters and healers. */
const legacyRows = (rows) => (rows || []).filter((row) => LEGACY_ROLES.has(row.role));

/** A view's role as v1/v2 can carry it: a new role reads as "" (every role). */
const legacyRole = (role) => (LEGACY_ROLES.has(role) ? role : "");

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
 * @param {string} [ctx.role]           "" | "caster" | "healer" (tank, melee and ranged read as "")
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
            role: legacyRole(ctx.role || ""),
            bisTier: built.bisTier || "",
            bisTierDerived: !!ctx.bisTierDerived,
        },
        categories,
        weights: {
            drought: Math.round(NEED_WEIGHTS.drought * 100),
            share: Math.round(NEED_WEIGHTS.share * 100),
            need: Math.round(NEED_WEIGHTS.need * 100),
        },
        avgLootCount: built.avgLootCount || 0,
        raiders: legacyRows(built.rows).map(raiderView),
    };
}

const VERSION_2 = 2;

/**
 * Version 2: every Loot-Council category in one answer, each computed with the
 * category's stored view exactly like the page (web/loot/councilView.js).
 * Raiders carry the v1 fields plus a stable `key` (the character key). Like
 * v1 it carries casters and healers only (LEGACY_ROLES).
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
        weights: {
            drought: Math.round(NEED_WEIGHTS.drought * 100),
            share: Math.round(NEED_WEIGHTS.share * 100),
            need: Math.round(NEED_WEIGHTS.need * 100),
        },
        categories: (entries || []).map(({ id, name, opts, built, instances }) => ({
            id: String(id),
            name: String(name || id),
            lootSystem: "lootcouncil",
            filter: {
                role: legacyRole(opts.role || ""),
                tiers: opts.tierIds || [],
                contents: opts.contentIds || [],
                bisTier: built.bisTier || "",
                bisTierDerived: !opts.bisTier,
                // The character version filter: "" = every version.
                version: opts.charVersion || "",
            },
            instances: instances || [],
            avgLootCount: built.avgLootCount || 0,
            raiders: legacyRows(built.rows).map((row) => ({ key: String(row.key || ""), ...raiderView(row) })),
        })),
    };
}

module.exports = { councilSyncPayload, councilSyncPayloadV2, classFileFor, FORMAT, VERSION, VERSION_2, MAX_ITEMS, LEGACY_ROLES };
