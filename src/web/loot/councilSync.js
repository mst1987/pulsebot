// The slim council roster the loot-sync tool pulls (GET /api/ingest/council) and
// writes into a Lua file for the in-game addon: who needs how much (the need
// score and its three parts) and what each raider already received. No gear
// details, sim data or URLs - the addon needs none of them.
//
// Format "eventhelper-council" version 1 (one category per answer, filters from
// the query), version 2 (every Loot-Council category at once, each with its
// stored page view) and version 3 (#670: version 2 plus every role, the roster
// status, the loot points and the category's own weighting, so the addon can
// weigh an award made after the sync like the server). The sync tool (repo
// eventhelper-addon) and its addon read the same shape: when a field changes,
// the version grows on both sides (docs/loot-import.md, "Council-Daten für das
// Addon").
//
// Pure: `built` is councilRoster()'s answer, everything else is passed in, so
// the mapping is tested with plain object literals. (Version 3 reads the item
// tables for the item classes, which are fixed data.)
const { NEED_WEIGHTS, DROUGHT_DAYS, droughtCounter } = require("./lootCouncil");
const { itemClass, itemFacts } = require("../../services/loot/itemWeights");
const { RAID_LOOT } = require("../../config/tbcContent");
const councilWeights = require("../../stores/councilWeightsStore");
const councilProfiles = require("../../services/loot/councilProfiles");

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

/** One received item; version 3 adds what it counted as (#668). */
function itemView(it, v3) {
    const out = {
        itemId: Number(it.itemId) || 0,
        itemName: it.itemName || "",
        awardedAt: seconds(it.awardedAt),
        boss: it.boss || "",
        reason: it.reasonLabel || it.reason || "",
        event: it.eventLabel || "",
    };
    if (v3) {
        const w = Number(it.weight);
        out.weight = Number.isFinite(w) ? w : 1;
        out.weightClass = it.weightClass || "normal";
    }
    return out;
}

function raiderView(row, v3 = false) {
    const bis = row.bis || {};
    const parts = row.needParts || {};
    const items = (row.items || [])
        .slice()
        .sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0))
        .slice(0, MAX_ITEMS)
        .map((it) => itemView(it, v3));
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
        weights: weightsPct(built),
        avgLootCount: built.avgLootCount || 0,
        raiders: legacyRows(built.rows).map((row) => raiderView(row)),
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
        // Top-level like before. A category with its own weighting (#668)
        // can differ; v2 has no per-category weights (version 3 has), so
        // this is the first category's, else the defaults.
        weights: weightsPct((entries && entries[0] && entries[0].built) || null),
        categories: (entries || []).map((entry) => ({
            ...categoryHead(entry, legacyRole(entry.opts.role || "")),
            raiders: legacyRows(entry.built.rows).map((row) => ({ key: String(row.key || ""), ...raiderView(row) })),
        })),
    };
}

/** What versions 2 and 3 say about a category before its raiders. */
function categoryHead({ id, name, opts, built, instances }, role) {
    return {
        id: String(id),
        name: String(name || id),
        lootSystem: "lootcouncil",
        filter: {
            role,
            tiers: opts.tierIds || [],
            contents: opts.contentIds || [],
            bisTier: built.bisTier || "",
            bisTierDerived: !opts.bisTier,
            // The character version filter: "" = every version.
            version: opts.charVersion || "",
        },
        instances: instances || [],
        avgLootCount: built.avgLootCount || 0,
    };
}

// ---- version 3 (#670) ---------------------------------------------------------

const VERSION_3 = 3;
const r6 = (x) => Math.round((Number(x) || 0) * 1e6) / 1e6;

/**
 * A category's need weighting as version 3 carries it: the four parts in %
 * (rounded, for the bar and the legend) and as exact shares of 1 (`shares`,
 * what needScore() multiplies with - a rounded percent would let the game's
 * score drift from the page's), the drought cap and the tenure saturation.
 * `built.weights` is councilRoster()'s weightsView(); without it the server's.
 */
function weightsV3(built) {
    const w = (built && built.weights) || weightsViewDefaults();
    const shares = w.needShares || NEED_WEIGHTS;
    const out = {};
    for (const id of councilWeights.NEED_IDS) out[id] = Math.round((Number(shares[id]) || 0) * 100);
    out.shares = {};
    for (const id of councilWeights.NEED_IDS) out.shares[id] = Number(shares[id]) || 0;
    out.droughtDays = Number(w.droughtDays) || DROUGHT_DAYS;
    out.tenureDays = Number(w.tenureDays) || councilWeights.DEFAULTS.tenureDays;
    out.scope = w.scope || "global";
    return out;
}

/** The default profile's weighting (#676) as councilRoster() would report it. */
function weightsViewDefaults() {
    const s = councilProfiles.weightsFor({});
    return { ...s, needShares: councilWeights.effectiveNeedWeights(s.need), droughtDays: DROUGHT_DAYS };
}

/**
 * The item weighting in effect for the category (its own settings, else the
 * server's): the weight of each item class and the per-item exceptions
 * ({ itemId: weight }).
 */
function itemWeightsV3(built) {
    const w = (built && built.weights) || weightsViewDefaults();
    const classes = {};
    for (const id of councilWeights.CLASS_IDS) {
        const v = Number((w.classes || {})[id]);
        classes[id] = Number.isFinite(v) ? v : councilWeights.DEFAULTS.classes[id];
    }
    const overrides = {};
    for (const [id, entry] of Object.entries(w.items || {})) {
        const v = Number(entry && typeof entry === "object" ? entry.weight : entry);
        if (Number(id) > 0 && Number.isFinite(v)) overrides[String(Number(id))] = v;
    }
    return { classes, overrides };
}

const classesCache = new Map();

/**
 * Item id -> class for every drop of the category's raids (the instances of
 * its raid template; without any, every raid of the loot table), so the addon
 * can weigh an award itself. Without the raider-specific half: a weapon reads
 * "weapon" here and the addon makes it "bisWeapon" for a raider whose
 * `bisWeapons` hold it - the order of itemWeights.js (frequent and trinket
 * come before weapon) makes that upgrade exact. Exceptions are not applied
 * (they come separately in `itemWeights.overrides` and win). "normal" is
 * left out: an id the map does not know is "normal" in the addon anyway.
 */
function itemClassesFor(instances) {
    const known = (instances || []).map((i) => i && i.id).filter((id) => RAID_LOOT[id]);
    const contentIds = known.length ? known : Object.keys(RAID_LOOT);
    const cacheKey = contentIds.join(",");
    if (classesCache.has(cacheKey)) return classesCache.get(cacheKey);
    const out = {};
    for (const contentId of contentIds) {
        for (const ids of Object.values(RAID_LOOT[contentId])) {
            for (const id of ids) {
                const cls = itemClass(id, { classes: {}, items: {} });
                if (cls !== "normal") out[String(id)] = cls;
            }
        }
    }
    classesCache.set(cacheKey, out);
    return out;
}

/** One raider in version 3: the v2 fields plus status, points, tenure and the drought state. */
function raiderViewV3(row) {
    const base = raiderView(row, true);
    const parts = row.needParts || {};
    const bisWeapons = [...new Set(((row.bis && row.bis.items) || [])
        .map((i) => Number(i.id) || 0)
        .filter((id) => id && itemFacts(id).weapon))];
    const counter = droughtCounter((row.items || []).map((it) => ({ awardedAt: it.awardedAt, weight: it.weight })));
    const fallbackDrought = row.daysSinceLoot === null || row.daysSinceLoot === undefined
        ? DROUGHT_DAYS : Math.min(DROUGHT_DAYS, row.daysSinceLoot);
    return {
        key: String(row.key || ""),
        ...base,
        parts: { ...base.parts, tenure: pct(parts.tenure) },
        // core / trial / bench in a category with a roster (#667), else "".
        status: row.status || "",
        lootPoints: typeof row.lootPoints === "number" ? row.lootPoints : (row.lootCount || 0),
        // The wait as it counts (one decimal, what the score used) and the
        // counter right after the newest award (droughtCounter(); the full
        // DROUGHT_DAYS without one) - the addon continues the walk from there.
        droughtDays: typeof row.droughtDays === "number" ? row.droughtDays : fallbackDrought,
        droughtBase: counter === null ? DROUGHT_DAYS : r6(counter),
        joinedAt: seconds(row.joinedAt),
        tenureDays: row.tenureDays || 0,
        // The weapons on this raider's BiS list: for them such a drop is a "bisWeapon".
        bisWeapons,
    };
}

/**
 * Version 3: version 2 with every council role (caster, healer, tank, melee,
 * ranged - no LEGACY_ROLES filter), the roster status, loot points, tenure and
 * the drought state per raider, and per category its own weighting
 * (`weights`, `itemWeights`) and the item classes of its raids
 * (`itemClasses`). The top-level `weights` is the first category's (else the
 * server's), for a reader that wants one.
 *
 * @param {object[]} entries  as for councilSyncPayloadV2()
 * @param {{ now?: number }} [ctx]
 */
function councilSyncPayloadV3(entries, ctx = {}) {
    const categories = (entries || []).map((entry) => ({
        ...categoryHead(entry, entry.opts.role || ""),
        // Where the values came from (#676): the roster this category's council
        // runs for (null without one) and its Loot-Council profile. Information
        // only - the addon keys a council by `id`, which stays the category id.
        roster: entry.roster ? { id: String(entry.roster.id), name: String(entry.roster.name || "") } : null,
        profile: entry.profile ? { id: String(entry.profile.id), name: String(entry.profile.name || "") } : null,
        avgLootPoints: entry.built.avgLootPoints || 0,
        weights: weightsV3(entry.built),
        itemWeights: itemWeightsV3(entry.built),
        itemClasses: itemClassesFor(entry.instances),
        raiders: (entry.built.rows || []).map(raiderViewV3),
    }));
    return {
        format: FORMAT,
        version: VERSION_3,
        generatedAt: seconds(ctx.now || Date.now()),
        weights: categories.length ? categories[0].weights : weightsV3(null),
        categories,
    };
}

module.exports = {
    councilSyncPayload, councilSyncPayloadV2, councilSyncPayloadV3, classFileFor, itemClassesFor,
    FORMAT, VERSION, VERSION_2, VERSION_3, MAX_ITEMS, LEGACY_ROLES,
};
