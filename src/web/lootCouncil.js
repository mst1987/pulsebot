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
const { classLook } = require("./lootClassLook");
const { characterMap } = require("./characterStore");
const { gearByCharacter } = require("./charGear");
const { CONTENTS, TIERS, content: contentMeta, sourceForItem } = require("../config/tbcContent");
const { SLOT_NAMES } = require("../utils/logcheck/gearIssues");
const { characterProfile } = require("../utils/setupView");
const { targetSlotFor } = require("../utils/wowsims/loadout");
const wowsims = require("../config/wowsims");
const {
    ROLES, specFor, specByKey, weightsFor, hitCapFor, bisForSpec, isSimSupported, bisSpecsForItem,
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

// How many of the newest awards decide which tier the guild is currently in.
// Enough to cover a few raid nights, few enough that last expansion's clears do
// not outvote this month's.
const TIER_SAMPLE = 60;

/**
 * The raid tier the guild is actually in, taken from its newest loot.
 *
 * This is the default BiS list to measure against, and taking it from the data
 * is the only sensible answer: "the newest list WoWSims has" would hold a T6
 * guild against Sunwell gear it cannot get, which makes every raider look
 * equally far from BiS and the whole column useless. Falls back to the newest
 * tier when there is no loot to learn from yet.
 */
function currentTier(rows) {
    const counts = new Map();
    for (const it of (rows || []).slice(0, TIER_SAMPLE)) {
        const tier = (contentMeta(it.contentId) || {}).tier;
        if (tier) counts.set(tier, (counts.get(tier) || 0) + 1);
    }
    if (!counts.size) return TIERS[TIERS.length - 1].id;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
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

/**
 * Which specs have this item on their BiS list, ready to render: the spec's own
 * icon and class colour next to its name.
 *
 * "Ist BiS" is not a property of an item, it is a property of an item *for a
 * spec* — and most caster drops are contested (29 of the 50 items on a T6
 * caster BiS list are wanted by more than one spec). So every item that carries
 * a BiS mark also carries whose.
 */
function bisSpecsView(itemId, tierId) {
    return bisSpecsForItem(itemId, tierId).map((owner) => {
        const look = characterProfile(owner.className, owner.spec) || {};
        return {
            specKey: owner.specKey,
            label: owner.label,
            iconUrl: look.iconUrl || "",
            classColor: look.classColor || "",
            role: owner.role,
            tier: owner.tier,
            // Specs that borrow this list — an assumption, and shown as one.
            alsoFor: owner.alsoFor,
        };
    });
}

/** Trim a wowsims item entry for the client. */
function itemView(itemId, tierId = "") {
    const item = wowsims.item(itemId);
    const id = Number(itemId);
    const bisSpecs = bisSpecsView(id, tierId);
    if (!item) return { id, name: "", iconUrl: "", ilvl: 0, quality: 0, stats: {}, contentId: "", boss: "", bisSpecs };
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
        bisSpecs,
    };
}

/**
 * One worn piece, as the page draws it: the log's own name and icon, plus what
 * the item table knows on top (stats, quality, which raid it came from).
 *
 * Deliberately the log's icon rather than the table's — the log saw what the
 * raider actually wears, including items the generated table does not carry, and
 * an icon-less square in a row of gear reads as "slot empty" when it only means
 * "not in our table".
 *
 * `isBis` is resolved here because only the server knows this raider's BiS list.
 */
function wornItemView(item, bisIds, tierId = "") {
    const known = wowsims.item(item.itemId);
    const source = sourceForItem(item.itemId) || {};
    return {
        // Whose BiS list this piece is on — not just "is it BiS", which says
        // nothing when nine specs share one item table.
        bisSpecs: bisSpecsView(item.itemId, tierId),
        slot: item.slot,
        slotName: item.slotName,
        itemId: item.itemId,
        itemName: item.itemName || (known ? known.name : "") || `Item ${item.itemId}`,
        // Always a string: an undefined src renders as a broken image, which in
        // a row of gear icons reads as "this slot is broken" rather than "we
        // have no picture of it".
        iconUrl: item.iconUrl || "",
        // WCL's quality is authoritative for a worn item; the table fills in for
        // rows an older report stored without one.
        quality: item.quality !== null && item.quality !== undefined ? item.quality : (known ? known.quality : null),
        itemLevel: item.itemLevel || (known ? known.ilvl : 0),
        stats: known ? known.stats : {},
        contentId: source.content || "",
        boss: source.boss || "",
        gemCount: (item.gems || []).filter(Boolean).length,
        emptySockets: item.emptySockets,
        // "missing" is the one worth showing — an unenchanted slot is the most
        // common thing a council spots on a raider asking for an upgrade.
        enchantStatus: item.enchantStatus,
        isBis: bisIds.has(Number(item.itemId)),
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
 *   bisTier     which tier's BiS list to measure against
 *               (default: the tier the guild's newest loot comes from)
 */
function councilRoster(opts = {}) {
    const { role = "", categoryId = "" } = opts;
    const contentFilter = resolveContentFilter(opts);
    const info = new Map(annotatedCharacters().map((c) => [c.key, c]));
    const gearMap = gearByCharacter();
    // Class colour and spec icon are resolved server-side, like everywhere else
    // in the app — the client never keeps a second copy of the WoW palette.
    const charStore = characterMap();
    const now = Date.now();

    const allLoot = listAll();
    const bisTier = opts.bisTier || currentTier(allLoot);

    // Loot per character, split into "counts for the filter" and "all of it".
    const loot = new Map();
    for (const it of allLoot) {
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
        // Three sources for class and spec, and all three are needed:
        // characterInfo only annotates raiders who appear in the loot history,
        // so a raider who has never won anything — exactly the case this page
        // exists for — would have no spec and be dropped as "not a caster".
        // The character store knows them from the log evaluations, and the
        // report's own roster still knows at least the class.
        const known = info.get(key) || charStore[key] || {};
        const gear = gearMap.get(key) || null;
        const className = known.className || (gear && gear.className) || "";
        const specEntry = specFor(className, known.spec);
        if (!specEntry) continue;
        if (role && specEntry.role !== role) continue;

        const bucket = loot.get(key) || { all: [], filtered: [] };
        const filtered = bucket.filtered.sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
        const lastAwardAt = filtered.length ? filtered[0].awardedAt : 0;
        const bis = bisForSpec(specEntry, bisTier);
        // Copies, not ids: a BiS list can name the same item twice (the shadow
        // priest's T6 list wants Ring of Recurrence in *both* finger slots), and
        // owning one of them does not close the second gap. So the worn items
        // are counted and spent one per BiS entry.
        const wornCount = new Map();
        for (const it of (gear && gear.items) || []) {
            const id = Number(it.itemId);
            wornCount.set(id, (wornCount.get(id) || 0) + 1);
        }
        const bisItems = bis.items.map((entry) => {
            const id = Number(entry.id);
            const left = wornCount.get(id) || 0;
            if (left > 0) wornCount.set(id, left - 1);
            return { ...itemView(id, bisTier), owned: left > 0 };
        });
        const bisIds = new Set(bis.items.map((entry) => Number(entry.id)));

        const look = classLook(charStore, key);
        rows.push({
            key,
            character: (bucket.all[0] && bucket.all[0].character) || (gear && gear.character) || key,
            className,
            classColor: look.classColor,
            specIconUrl: look.specIconUrl,
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
                // The worn pieces themselves, in character-sheet order, so the
                // page can show the raider's gear as a row of icons. Whether a
                // piece is on their BiS list is decided here rather than in the
                // client, which has no BiS list per raider to check against.
                items: gear.items.map((it) => wornItemView(it, bisIds, bisTier)),
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
    // bisTier goes back out so the page can show which list it is measuring
    // against — especially when nobody picked one and it was derived.
    return { rows, avgLootCount: Math.round(avg * 10) / 10, bisTier };
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
            classColor: row.classColor,
            specKey: row.specKey,
            specLabel: row.specLabel,
            // Carried so the candidate list can show the spec as its icon, the
            // same way the roster table does.
            specIconUrl: row.specIconUrl,
            slot: target.slot,
            slotName: target.replaces ? target.replaces.slotName : (SLOT_NAMES[target.slot] || `Slot ${target.slot}`),
            // The full view of what would come off, not just its name: a council
            // deciding on a drop wants to see the piece it replaces — icon,
            // item level, whether it is enchanted, whether it was on that
            // raider's BiS list.
            replaces: target.replaces
                ? wornItemView(target.replaces, new Set(row.bis.items.map((i) => i.id)), row.bis.tier)
                : null,
            value,
            isBis,
            // The fairness half of the decision, carried alongside the gear
            // gain rather than folded into it: "who would gain most" and "who
            // has waited longest" are two different questions, and a council
            // that only ever sees them multiplied together cannot weigh them
            // against each other. Same numbers as the roster table, so a name
            // cannot look overdue in one view and satisfied in the other.
            needScore: row.needScore,
            needParts: row.needParts,
            lootCount: row.lootCount,
            lootTotal: row.lootTotal,
            daysSinceLoot: row.daysSinceLoot,
            lastAwardAt: row.lastAwardAt,
            bisOwned: row.bis.owned,
            bisTotal: row.bis.total,
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
 *
 * A raider appears once per item even when their list wants two copies of it
 * (both finger slots); `missing` on their entry says how many they still need,
 * so a second drop of that ring has an answer too.
 */
function bisGaps(roster, { contentIds = null } = {}) {
    const byItem = new Map();
    for (const row of roster) {
        const seen = new Map();
        for (const item of row.bis.items) {
            if (item.owned) continue;
            if (contentIds && item.contentId && !contentIds.has(item.contentId)) continue;
            if (!byItem.has(item.id)) byItem.set(item.id, { ...item, wantedBy: [] });
            // Second copy of the same item for the same raider: count it up on
            // the entry that is already there instead of listing them twice.
            const already = seen.get(item.id);
            if (already) {
                already.missing += 1;
                continue;
            }
            const entry = {
                missing: 1,
                key: row.key,
                character: row.character,
                specKey: row.specKey,
                specLabel: row.specLabel,
                needScore: row.needScore,
            };
            seen.set(item.id, entry);
            byItem.get(item.id).wantedBy.push(entry);
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
    councilRoster, candidatesForItem, bisGaps, filterOptions, currentTier, wornItemView, bisSpecsView,
    upgradeValue, needScore, scoreItem, gearSpellHit, resolveContentFilter, itemView,
};
