// What the caster loot council actually looks at: per raider, what they were
// given lately, how far their gear still is from BiS, and — when the simulation
// can answer — what a given drop would be worth to them in DPS.
//
// Everything is derived on read, nothing is stored. The inputs are the ones the
// bot already keeps:
//   - the loot history (lootStore, already decorated with raid content and the
//     award reason)
//   - class and spec per character (characterInfo)
//   - the gear each raider was last logged in (charGear, out of the CLA reports)
//   - the BiS lists and item stats vendored from WoWSims (config/wowsims)
//
// The simulation half lives in web/simStore.js — it takes seconds per raider and
// runs as a background job, while everything here answers in one page load.

const { listAll } = require("./lootStore");
const { annotatedCharacters } = require("./characterInfo");
const { gearByCharacter } = require("./charGear");
const { CONTENTS, TIERS, content: contentMeta, sourceForItem } = require("../config/tbcContent");
const { targetSlotFor } = require("../utils/wowsims/loadout");
const wowsims = require("../config/wowsims");
const {
    ROLES, specFor, specByKey, weightsFor, hitCapFor, bisForSpec, isSimSupported,
} = require("../config/casterSpecs");

const DAY = 24 * 60 * 60 * 1000;

/** The contents belonging to a set of tier ids. */
function contentsForTiers(tierIds) {
    const wanted = new Set(tierIds || []);
    return CONTENTS.filter((c) => wanted.has(c.tier)).map((c) => c.id);
}

/**
 * Resolve the content filter the page sends. Tiers and contents can be combined
 * — "T5 plus Hyjal" is a real council question when a guild has just moved on —
 * and an empty filter means everything, never nothing.
 */
function resolveContentFilter({ tierIds = [], contentIds = [] } = {}) {
    const ids = new Set([...contentsForTiers(tierIds), ...(contentIds || [])]);
    return ids.size ? ids : null;
}

/** Sum an item's stats against a spec's weights. Unknown items score 0. */
function scoreItem(itemId, weights) {
    const item = wowsims.item(itemId);
    if (!item) return 0;
    let score = 0;
    for (const [stat, value] of Object.entries(item.stats)) {
        score += (weights[stat] || 0) * value;
    }
    return Math.round(score * 10) / 10;
}

/**
 * The spell hit a raider already has from gear. Needed because hit is the one
 * stat whose value collapses the moment it is enough: past the cap another
 * point of hit is worth nothing, and a council that ignores that hands the
 * hit-capped raider the hit trinket.
 */
function gearSpellHit(gear) {
    let hit = 0;
    for (const it of (gear && gear.items) || []) {
        const item = wowsims.item(it.itemId);
        if (item && item.stats.spellHit) hit += item.stats.spellHit;
    }
    return hit;
}

/**
 * The stat-weight value of putting `itemId` in, minus the item it replaces.
 * The fallback for everything the simulation cannot answer — a healer, a spec
 * WoWSims does not model, a run without the binary.
 *
 * Hit above the cap is dropped from BOTH sides of the comparison, so a raider
 * who is already capped sees the true value of a hit item (its other stats)
 * rather than a phantom gain, and does not get punished for losing hit they did
 * not need either.
 */
function upgradeValue({ gear, specEntry, itemId, replaces }) {
    const weights = weightsFor(specEntry);
    const cap = hitCapFor(specEntry);
    const current = gearSpellHit(gear);

    const usefulHit = (item, delta) => {
        if (!cap || !item || !item.stats.spellHit) return 0;
        // How much of this item's hit is below the cap, given what the raider
        // already wears (minus whatever the replaced item contributed).
        const base = Math.max(0, current + delta);
        return Math.max(0, Math.min(item.stats.spellHit, cap - base));
    };

    const incoming = wowsims.item(itemId);
    const outgoing = replaces ? wowsims.item(replaces.itemId) : null;
    const outgoingHit = outgoing ? (outgoing.stats.spellHit || 0) : 0;

    const scoreOf = (item, hitCounted) => {
        if (!item) return 0;
        let score = 0;
        for (const [stat, value] of Object.entries(item.stats)) {
            if (stat === "spellHit") continue;
            score += (weights[stat] || 0) * value;
        }
        return score + (weights.spellHit || 0) * hitCounted;
    };

    const inScore = scoreOf(incoming, usefulHit(incoming, -outgoingHit));
    const outScore = scoreOf(outgoing, Math.max(0, Math.min(outgoingHit, cap - Math.max(0, current - outgoingHit))));
    return Math.round((inScore - outScore) * 10) / 10;
}

/** Trim a wowsims item entry for the client. */
function itemView(itemId) {
    const item = wowsims.item(itemId);
    const id = Number(itemId);
    if (!item) return { id, name: "", iconUrl: "", ilvl: 0, quality: 0, stats: {}, contentId: "", boss: "" };
    const source = sourceForItem(id) || {};
    return {
        id,
        name: item.name,
        iconUrl: item.icon ? `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg` : "",
        ilvl: item.ilvl,
        quality: item.quality,
        stats: item.stats,
        setName: item.setName || "",
        contentId: source.content || "",
        boss: source.boss || "",
    };
}

/**
 * How urgently a raider should be considered for the next drop, and why.
 *
 * Three inputs, each capped so no single one can dominate:
 *   - drought: how long since their last item (the fairness half a council
 *     argues about out loud)
 *   - share:   how few items they got in the filtered content compared to the
 *              other casters in the same filter
 *   - need:    how far their gear still is from the BiS list (the "would it
 *              even help them" half)
 *
 * Deliberately transparent rather than clever: the components go out with the
 * score so the page can show the reasoning, and a council can disagree with a
 * number it can see the parts of.
 */
function needScore({ daysSinceLoot, lootCount, avgLootCount, bisOwned, bisTotal }) {
    // 30 days without an item is as much drought as this counts.
    const drought = Math.min(1, (daysSinceLoot === null ? 30 : daysSinceLoot) / 30);
    // Half the average is "clearly behind", twice it is "clearly ahead".
    const share = avgLootCount > 0
        ? Math.max(0, Math.min(1, (avgLootCount - lootCount) / Math.max(1, avgLootCount)))
        : 0.5;
    const need = bisTotal > 0 ? 1 - (bisOwned / bisTotal) : 0.5;
    const score = 0.4 * drought + 0.3 * share + 0.3 * need;
    return {
        score: Math.round(score * 1000) / 1000,
        parts: {
            drought: Math.round(drought * 1000) / 1000,
            share: Math.round(share * 1000) / 1000,
            need: Math.round(need * 1000) / 1000,
        },
    };
}

/**
 * The council roster: every caster/healer with loot history or known gear.
 *
 * @param {object} opts
 *   role        "caster" | "healer" | "" (both)
 *   tierIds     tier ids to count loot from ([] = all)
 *   contentIds  extra content ids to count loot from
 *   categoryId  restrict to one raid category (the Monday raid, say)
 *   bisTier     which tier's BiS list to measure against (default: newest)
 */
function councilRoster(opts = {}) {
    const { role = "", categoryId = "", bisTier = "" } = opts;
    const contentFilter = resolveContentFilter(opts);
    const info = new Map(annotatedCharacters().map((c) => [c.key, c]));
    const gearMap = gearByCharacter();
    const now = Date.now();

    // Loot per character, split into "counts for the filter" and "all of it".
    const loot = new Map();
    for (const it of listAll()) {
        const key = it.characterKey;
        if (!key) continue;
        if (categoryId && it.categoryId !== categoryId) continue;
        if (!loot.has(key)) loot.set(key, { all: [], filtered: [] });
        const bucket = loot.get(key);
        bucket.all.push(it);
        if (!contentFilter || contentFilter.has(it.contentId)) bucket.filtered.push(it);
    }

    // Everyone who could be on the council: known from loot, from a CLA report,
    // or from both. A raider who has never won an item still belongs on the
    // list — they are precisely the case the council is looking for.
    const keys = new Set([...loot.keys(), ...gearMap.keys()]);
    const rows = [];
    for (const key of keys) {
        const known = info.get(key) || {};
        const gear = gearMap.get(key) || null;
        const className = known.className || (gear && gear.className) || "";
        const specEntry = specFor(className, known.spec);
        if (!specEntry) continue;
        if (role && specEntry.role !== role) continue;

        const bucket = loot.get(key) || { all: [], filtered: [] };
        const filtered = bucket.filtered.sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
        const lastAwardAt = filtered.length ? filtered[0].awardedAt : 0;
        const bis = bisForSpec(specEntry, bisTier);
        const wornIds = new Set(((gear && gear.items) || []).map((it) => Number(it.itemId)));
        const bisItems = bis.items.map((entry) => ({
            ...itemView(entry.id),
            owned: wornIds.has(Number(entry.id)),
        }));

        rows.push({
            key,
            character: (bucket.all[0] && bucket.all[0].character) || (gear && gear.character) || key,
            className,
            spec: known.spec || "",
            specKey: specEntry.key,
            specLabel: specEntry.label,
            specAssumed: !!specEntry.assumedFromClass,
            role: specEntry.role,
            lootCount: filtered.length,
            lootTotal: bucket.all.length,
            lastAwardAt,
            daysSinceLoot: lastAwardAt ? Math.floor((now - lastAwardAt) / DAY) : null,
            items: filtered.map((it) => ({
                itemId: it.itemId,
                itemName: it.itemName,
                itemIconUrl: it.itemIconUrl,
                itemQuality: typeof it.itemQuality === "number" ? it.itemQuality : null,
                contentId: it.contentId,
                tier: (contentMeta(it.contentId) || {}).tier || "",
                boss: it.boss || "",
                reason: it.reason || "",
                reasonLabel: it.reasonLabel || "",
                reasonTone: it.reasonTone || "",
                awardedAt: it.awardedAt || 0,
                eventLabel: it.eventLabel || "",
            })),
            gear: gear ? {
                seenAt: gear.seenAt,
                reportId: gear.reportId,
                reportTitle: gear.reportTitle,
                itemCount: gear.items.length,
                spellHit: gearSpellHit(gear),
                hitCap: hitCapFor(specEntry),
            } : null,
            bis: {
                tier: bis.tier,
                exact: bis.exact,
                borrowedFrom: bis.borrowedFrom,
                total: bisItems.length,
                owned: bisItems.filter((i) => i.owned).length,
                items: bisItems,
            },
            simSupported: isSimSupported(specEntry),
        });
    }

    // The share component needs the field it is measured against, so the score
    // is added once the whole roster is known.
    const avg = rows.length ? rows.reduce((n, r) => n + r.lootCount, 0) / rows.length : 0;
    for (const row of rows) {
        const { score, parts } = needScore({
            daysSinceLoot: row.daysSinceLoot,
            lootCount: row.lootCount,
            avgLootCount: avg,
            bisOwned: row.bis.owned,
            bisTotal: row.bis.total,
        });
        row.needScore = score;
        row.needParts = parts;
    }
    rows.sort((a, b) => b.needScore - a.needScore || a.character.localeCompare(b.character));
    return { rows, avgLootCount: Math.round(avg * 10) / 10 };
}

/**
 * For one item: who on the roster it fits, what it would replace, and how much
 * it would be worth to each of them by stat weights.
 *
 * The list is the answer to the question a council actually asks — "this just
 * dropped, who gets it?" — so it keeps raiders the item is a *downgrade* for
 * too, marked as such: knowing that it helps nobody is an answer.
 */
function candidatesForItem(itemId, roster) {
    const item = wowsims.item(itemId);
    if (!item) return [];
    const gearMap = gearByCharacter();
    const out = [];
    for (const row of roster) {
        const specEntry = specByKey(row.specKey);
        const gear = gearMap.get(row.key) || null;
        const target = targetSlotFor(gear, itemId);
        if (!target) continue; // the item fits no slot this raider has
        const value = upgradeValue({ gear, specEntry, itemId, replaces: target.replaces });
        const isBis = row.bis.items.some((i) => i.id === Number(itemId));
        out.push({
            key: row.key,
            character: row.character,
            specKey: row.specKey,
            specLabel: row.specLabel,
            slot: target.slot,
            replaces: target.replaces ? {
                itemId: target.replaces.itemId,
                itemName: target.replaces.itemName,
                itemLevel: target.replaces.itemLevel,
            } : null,
            value,
            isBis,
            needScore: row.needScore,
            lootCount: row.lootCount,
            daysSinceLoot: row.daysSinceLoot,
            hasGear: !!gear,
            simSupported: row.simSupported,
        });
    }
    // Biggest gear gain first; the need score only breaks ties, because a
    // council weighs fairness itself and should see the raw upgrade unblurred.
    out.sort((a, b) => b.value - a.value || b.needScore - a.needScore);
    return out;
}

/**
 * The BiS overview: every item on the roster's BiS lists that somebody is still
 * missing, with who would gain most from it.
 *
 * Grouped by item rather than by raider on purpose — that is the shape a loot
 * council needs when a boss dies and one item is on the table.
 */
function bisGaps(roster, { contentIds = null } = {}) {
    const byItem = new Map();
    for (const row of roster) {
        for (const item of row.bis.items) {
            if (item.owned) continue;
            if (contentIds && item.contentId && !contentIds.has(item.contentId)) continue;
            if (!byItem.has(item.id)) byItem.set(item.id, { ...item, wantedBy: [] });
            byItem.get(item.id).wantedBy.push({
                key: row.key,
                character: row.character,
                specKey: row.specKey,
                specLabel: row.specLabel,
                needScore: row.needScore,
            });
        }
    }
    const items = [...byItem.values()];
    for (const item of items) {
        item.candidates = candidatesForItem(item.id, roster);
        item.best = item.candidates.length ? item.candidates[0] : null;
    }
    items.sort((a, b) => b.wantedBy.length - a.wantedBy.length || (b.best ? b.best.value : 0) - (a.best ? a.best.value : 0));
    return items;
}

/** The filter options the page offers, so the client needs no second source. */
function filterOptions() {
    return {
        roles: ROLES,
        tiers: TIERS,
        contents: CONTENTS.map((c) => ({ id: c.id, label: c.label, short: c.short, tier: c.tier })),
        bisTiers: TIERS.filter((t) => wowsims.specsWithBis().some((s) => wowsims.bisTiers(s).includes(t.id))),
    };
}

module.exports = {
    councilRoster, candidatesForItem, bisGaps, filterOptions,
    upgradeValue, needScore, scoreItem, gearSpellHit, resolveContentFilter, itemView,
};
