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
// The simulation half lives in stores/simStore.js — it takes seconds per raider and
// runs as a background job, while everything here answers in one page load.

const { listAll } = require("../../stores/lootStore");
const { annotatedCharacters } = require("../../services/characters/characterInfo");
const { classLook } = require("./lootClassLook");
const { characterMap } = require("../../stores/characterStore");
const { gearByCharacter } = require("../../services/loot/charGear");
const { countsAsLoot } = require("../../utils/loot/lootReasons");
const { getCategoryAssignments } = require("../../stores/raiderCharactersStore");
const { excludedKeys, plannedRoles } = require("../../stores/councilStore");
const { versionLinks } = require("../../services/events/versionSettings");
const { buildVersionContext, versionsOfCharacter, versionChoices } = require("../../services/characters/characterVersions");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { characterKey, characterKeyOf } = require("../../utils/loot/lootImport");
const { rosterCandidates } = require("./councilRosterSource");
const { listStoredEvents } = require("../../services/events/eventSources");
const { listLogs } = require("../../stores/logStore");
const { listReports, getReportRoster } = require("../../stores/reportStore");
const { CONTENTS, TIERS, content: contentMeta, sourceForItem } = require("../../config/tbcContent");
const { SLOT_NAMES } = require("../../utils/logcheck/gearIssues");
const { characterProfile } = require("../../utils/setup/setupView");
const { targetSlotFor } = require("../../utils/wowsims/loadout");
const wowsims = require("../../config/wowsims");
const bisSource = require("../../config/bisSets");
const { wearCheck } = require("../../config/wearable");
const {
    ROLES, specFor, specByKey, specForRole, rolesForClass, weightsFor, hitStatFor, hitCapFor,
    bisForSpec, isSimSupported, bisSpecsForItem,
} = require("../../config/councilSpecs");
const councilWeights = require("../../stores/councilWeightsStore");
const councilProfiles = require("../../services/loot/councilProfiles");
const { itemWeight } = require("../../services/loot/itemWeights");
const { tenureContext, tenureDays: tenureDaysOf } = require("../../services/loot/councilTenure");

const DAY = 24 * 60 * 60 * 1000;

// How many recent awards ride along on a candidate. Enough to answer "was hat
// der schon bekommen?" in a hover, few enough that the panel needs no scrolling
// — the character page has the full history.
const RECENT_ITEMS = 8;

/** The equip slot an item goes in first (a ring's first finger), -1 if unknown. */
function firstSlotFor(itemId) {
    const slots = wowsims.slotsFor(itemId);
    return slots.length ? Number(slots[0]) : -1;
}

/** The slot's German name, "" when the item table does not know the item. */
function slotNameFor(itemId) {
    const slot = firstSlotFor(itemId);
    if (slot < 0) return "";
    // A doubled slot is named without its number: which finger a ring lands on
    // is the raider's business, not the matrix's.
    return (SLOT_NAMES[slot] || `Slot ${slot}`).replace(/ [12]$/, "");
}

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

// How many stored evaluations are walked to find out who raids a category.
// Same bound and reason as charGear's: far enough back to cover the current
// roster, without reading years of files on every page view.
const MAX_CATEGORY_REPORTS = 40;

/**
 * Everyone the *logs* say raided in this category.
 *
 * The chain is Report → Log (`reportRefId`) → `eventId` → raid event →
 * `categoryId`. It is the strongest of the three sources, because it is not a
 * list anybody has to maintain: whoever shows up in the log of a Monday raid
 * raids on Mondays, full stop.
 */
function categoryFromReports(categoryId) {
    const keys = new Set();
    // Which events belong to this category, from the persisted snapshot (it
    // keeps the category captured at scan time, so a deleted Discord channel
    // does not lose the event — see raidEventStore.js).
    const events = new Set(
        listStoredEvents()
            .filter((e) => e && e.categoryId === categoryId)
            .map((e) => String(e.id || e.eventId || "")),
    );
    if (!events.size) return keys;
    // Logs assigned to one of those events, and the evaluation each produced.
    const reportIds = new Set(
        listLogs()
            .filter((l) => l && l.eventId && events.has(String(l.eventId)) && l.reportRefId)
            .map((l) => String(l.reportRefId)),
    );
    if (!reportIds.size) return keys;
    for (const meta of listReports().slice(0, MAX_CATEGORY_REPORTS)) {
        if (!reportIds.has(String(meta.id))) continue;
        // only the roster, not the whole report: the timeline is 90 % of the file
        const report = getReportRoster(meta.id);
        for (const entry of (report && report.roster) || []) {
            const key = characterKeyOf(entry.name);
            if (key) keys.add(key);
        }
    }
    return keys;
}

/**
 * Which characters belong to one raid category — the answer to "zeig mir nur
 * den Montagsraid".
 *
 * Three sources, unioned, because no single one is complete:
 *   - the **logs** of that category's raids (`categoryFromReports`): who
 *     actually stood there. Needs nothing maintained by hand.
 *   - the **loot** awarded in that category: covers raids that were never
 *     evaluated, but cannot see anyone who never won something.
 *   - the raider→character **assignment** (raiderCharactersStore, Einstellungen
 *     → Kategorien): the only source that knows a raider who has neither won
 *     nor been logged there — a new member, say.
 *
 * ⚠️ When all three come up empty the filter still applies, and the roster comes
 * back empty. That is deliberate and was wrong before: falling back to "show
 * everyone" meant picking a category changed nothing, which is exactly the bug
 * this is fixing. An empty list plus `sources` (what was tried, what each one
 * found) tells the admin what to fix; a full list tells them nothing.
 */
function categoryMembers(categoryId, lootRows) {
    const id = String(categoryId || "").trim();
    if (!id) return null;

    const fromReports = categoryFromReports(id);
    const fromLoot = new Set();
    for (const it of lootRows) {
        if (it.categoryId === id && it.characterKey) fromLoot.add(it.characterKey);
    }
    const fromAssignment = new Set();
    for (const name of Object.values(getCategoryAssignments(id))) {
        const key = characterKey(name);
        if (key) fromAssignment.add(key);
    }

    const keys = new Set([...fromReports, ...fromLoot, ...fromAssignment]);
    return {
        keys,
        sources: {
            reports: fromReports.size,
            loot: fromLoot.size,
            assigned: fromAssignment.size,
        },
    };
}

/** Whether the table knows this item *and* a stat block for it. */
function hasStats(itemId) {
    const item = wowsims.item(itemId);
    return !!(item && item.stats && Object.keys(item.stats).length);
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
 * The hit a raider already has from gear — spell hit for a caster, physical
 * hit for everyone else (`stat`, see hitStatFor). Needed because hit is the one
 * stat whose value collapses the moment it is enough: past the cap another
 * point of hit is worth nothing, and a council that ignores that hands the
 * hit-capped raider the hit trinket.
 */
function gearHit(gear, stat = "spellHit") {
    if (!stat) return 0;
    let hit = 0;
    for (const it of (gear && gear.items) || []) {
        const item = wowsims.item(it.itemId);
        if (item && item.stats[stat]) hit += item.stats[stat];
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
    // The capped hit: spell hit for a caster, physical hit for melee, hunters
    // and tanks. A healer has none, and every stat counts at its plain weight.
    const hitStat = hitStatFor(specEntry);
    const current = gearHit(gear, hitStat);

    const usefulHit = (item, delta) => {
        if (!cap || !item || !item.stats[hitStat]) return 0;
        // How much of this item's hit is below the cap, given what the raider
        // already wears (minus whatever the replaced item contributed).
        const base = Math.max(0, current + delta);
        return Math.max(0, Math.min(item.stats[hitStat], cap - base));
    };

    const incoming = wowsims.item(itemId);
    const outgoing = replaces ? wowsims.item(replaces.itemId) : null;
    const outgoingHit = outgoing && hitStat ? (outgoing.stats[hitStat] || 0) : 0;

    const scoreOf = (item, hitCounted) => {
        if (!item) return 0;
        let score = 0;
        for (const [stat, value] of Object.entries(item.stats)) {
            if (hitStat && stat === hitStat) continue;
            score += (weights[stat] || 0) * value;
        }
        return score + (hitStat ? (weights[hitStat] || 0) * hitCounted : 0);
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
        // The socketed gems and the enchant as ids, for the Wowhead tooltip
        // (item=…&gems=…&ench=…) — it then shows the piece as the raider
        // actually wears it, not the bare item.
        gemIds: (item.gems || []).map((g) => Number(g) || 0).filter(Boolean),
        enchantId: Number(item.enchantId) || 0,
        emptySockets: item.emptySockets,
        // "missing" is the one worth showing — an unenchanted slot is the most
        // common thing a council spots on a raider asking for an upgrade.
        enchantStatus: item.enchantStatus,
        isBis: bisIds.has(Number(item.itemId)),
        // A piece that only pays off against certain bosses (Mark of the
        // Champion and its like), and — the other side of the same coin — the
        // situational piece this one was substituted in for. Both go to the
        // page: a slot the comparison cannot read is exactly what a council
        // needs to be told about before it weighs a gain.
        situational: item.situational || null,
        replacedSituational: item.replacedSituational || null,
    };
}

/**
 * How urgently a raider should be considered for the next drop, and why.
 *
 * Four inputs, each capped to 0..1 so no single one can dominate:
 *   - drought: how long they have waited — the effective days of droughtDays(),
 *              in which a small item resets the wait only partly (the fairness
 *              half a council argues about out loud)
 *   - share:   how few loot points they got in the filtered content compared to
 *              the field's average
 *   - need:    how far their gear still is from the BiS list (the "would it
 *              even help them" half)
 *   - tenure:  how long they have belonged to the raid (councilTenure.js),
 *              linear up to the saturation (default 90 days)
 *
 * The weights are the council's (stores/councilWeightsStore.js, default
 * 45 / 30 / 10 / 15), normalised to a sum of 1, so the score stays 0..1 whatever
 * is set. Deliberately transparent rather than clever: the components go out
 * with the score so the page can show the reasoning, and a council can disagree
 * with a number it can see the parts of.
 */
// The default weights as shares of 1: the wait counts most, the loot share
// next, belonging after that and the BiS gap least — a raider far from BiS is
// not owed an item, a raider who has waited and stayed is. (50/40/10 until
// #668 added belonging and made them adjustable.)
const NEED_WEIGHTS = Object.freeze(councilWeights.effectiveNeedWeights(councilWeights.DEFAULTS.need));

// A candidate for whom the drop is not on their BiS list is weighed at this
// share of their need and gain: the item still helps them, but somebody it is
// BiS for should come first unless the numbers are far apart.
const NON_BIS_WEIGHT = 0.5;

// Days without an item at which the drought part is full.
const DROUGHT_DAYS = 30;

/**
 * The wait as effective days, with a partial reset per award (#668).
 *
 * A running counter D (days, capped at DROUGHT_DAYS) walks the awards oldest
 * first. Before the first award it is full (never got anything = the full
 * drought). Between two awards it grows by the days in between, capped again.
 * At an award of weight w it becomes D × max(0, 1 − w): an item of weight 1 or
 * more resets the wait completely, one of 0.5 halves it, one of 0 leaves it.
 * After the newest award it grows by the whole days since (`daysSinceLoot`).
 *
 * With every weight ≥ 1 this is exactly the old rule, min(30, days since the
 * last item); weights above 1 cannot reset more than fully — they count extra
 * in the share instead.
 *
 * @param {{ awardedAt: number, weight: number }[]} awards  the counted awards (any order)
 * @param {number|null} daysSinceLoot  whole days since the newest one (null = never)
 * @returns {number} effective days, 0..DROUGHT_DAYS, one decimal
 */
function droughtDays(awards, daysSinceLoot) {
    const d = droughtCounter(awards);
    if (d === null || daysSinceLoot === null || daysSinceLoot === undefined) return DROUGHT_DAYS;
    return Math.round(Math.min(DROUGHT_DAYS, d + daysSinceLoot) * 10) / 10;
}

/**
 * The counter of droughtDays() right after the newest award, before the days
 * since then are added — unrounded; null without any award. The addon format
 * v3 carries it (`droughtBase`, councilSync.js), so the game can continue the
 * walk with an award made after the sync exactly like this function would.
 * @param {{ awardedAt: number, weight: number }[]} awards  any order, ms
 * @returns {number|null}
 */
function droughtCounter(awards) {
    const list = (awards || []).filter((a) => a && a.awardedAt).sort((a, b) => a.awardedAt - b.awardedAt);
    if (!list.length) return null;
    let d = DROUGHT_DAYS;
    let prev = 0;
    for (const a of list) {
        if (prev) d = Math.min(DROUGHT_DAYS, d + (a.awardedAt - prev) / DAY);
        d *= Math.max(0, 1 - (Number(a.weight) || 0));
        prev = a.awardedAt;
    }
    return d;
}

/**
 * @param {object} input
 *   droughtDays    effective days (droughtDays()); null = never got anything
 *   lootPoints     their loot points in the filter
 *   avgLootPoints  the field's average loot points
 *   bisOwned, bisTotal
 *   tenureDays     days since "dabei seit" (0 without a date)
 * @param {object} [weights]  { drought, share, need, tenure } as shares of 1
 * @param {number} [tenureSaturation]  days at which the tenure part is full
 */
function needScore(input, weights = NEED_WEIGHTS, tenureSaturation = councilWeights.DEFAULTS.tenureDays) {
    const { bisOwned, bisTotal } = input;
    const days = input.droughtDays === null || input.droughtDays === undefined ? DROUGHT_DAYS : input.droughtDays;
    const points = Number(input.lootPoints) || 0;
    const avg = Number(input.avgLootPoints) || 0;
    const drought = Math.min(1, days / DROUGHT_DAYS);
    // Half the average is "clearly behind", twice it is "clearly ahead".
    const share = avg > 0
        ? Math.max(0, Math.min(1, (avg - points) / Math.max(1, avg)))
        : 0.5;
    const need = bisTotal > 0 ? 1 - (bisOwned / bisTotal) : 0.5;
    const tenure = Math.min(1, Math.max(0, Number(input.tenureDays) || 0) / Math.max(1, tenureSaturation));
    const w = { drought: 0, share: 0, need: 0, tenure: 0, ...weights };
    const score = w.drought * drought + w.share * share + w.need * need + w.tenure * tenure;
    const r3 = (x) => Math.round(x * 1000) / 1000;
    return {
        score: r3(score),
        parts: { drought: r3(drought), share: r3(share), need: r3(need), tenure: r3(tenure) },
    };
}

/** The weighting a council request runs with: the stored settings plus the shares of 1 the score uses. */
function resolveWeights(settings) {
    const s = settings || councilProfiles.weightsFor({});
    return { ...s, needShares: councilWeights.effectiveNeedWeights(s.need) };
}

/** The weighting as the page and the addon get it. */
function weightsView(w) {
    return {
        scope: w.scope || "global",
        classes: w.classes,
        items: w.items,
        need: w.need,
        needShares: w.needShares,
        tenureDays: w.tenureDays,
        droughtDays: DROUGHT_DAYS,
    };
}

// ---- the council roster -------------------------------------------------------
//
// councilRoster() loads (judgedRoles, lootByCharacter, the gear), builds one
// row per raider (rosterRow and its views) and scores the field (scoreRows).

/**
 * Which role each raider is judged as, so a night spent healing does not
 * become their DPS gear (see charGear.js). Resolved from the same sources the
 * roster rows use, one pass ahead of them. Returns the map and the raid lead's
 * planned roles it was overridden with.
 */
function judgedRoles() {
    const roleByKey = new Map();
    for (const [key, entry] of Object.entries(characterMap())) {
        const spec = specFor(entry.className, entry.spec);
        if (spec) roleByKey.set(key, spec.role);
    }
    for (const c of annotatedCharacters()) {
        const spec = specFor(c.className, c.spec);
        if (spec) roleByKey.set(c.key, spec.role);
    }
    // Was der Raidlead festgelegt hat, schlägt die Spec aus den Daten: ein
    // Heiler, der heute Offspec spielt, wird nach Casterset und Caster-BiS
    // beurteilt statt nach dem, womit er zuletzt geloggt wurde. Muss vor dem
    // Gear stehen — die Rolle entscheidet, welches Set überhaupt gesucht wird.
    const planned = plannedRoles();
    for (const [key, wanted] of planned) roleByKey.set(key, wanted);
    return { roleByKey, planned };
}

/**
 * Loot per character, split into "counts for the filter" and "all of it".
 *
 * The category narrows which items *count* — a raider assigned to Monday
 * who only ever won something on Thursday belongs in the Monday list with
 * zero items, not out of it. Who is on the list at all is decided in
 * councilRoster.
 */
function lootByCharacter(allLoot, categoryId, contentFilter) {
    const loot = new Map();
    for (const it of allLoot) {
        const key = it.characterKey;
        if (!key) continue;
        // The name is taken before the category cut, so a raider whose items
        // all belong to another raid is still shown by name rather than by key.
        if (!loot.has(key)) loot.set(key, { all: [], filtered: [], other: 0, character: it.character });
        const bucket = loot.get(key);
        if (categoryId && it.categoryId !== categoryId) continue;
        // An off-spec roll, a shard or a bank item did nothing for this raider's
        // main set, so it must not count towards "was schon bekommen". Counting
        // them would rank somebody who politely took three shards above a raider
        // who got one real upgrade. They are tallied separately (`other`) rather
        // than dropped silently, so the page can say they exist.
        if (!countsAsLoot(it.reason)) {
            bucket.other += 1;
            continue;
        }
        bucket.all.push(it);
        if (!contentFilter || contentFilter.has(it.contentId)) bucket.filtered.push(it);
    }
    return loot;
}

/**
 * The BiS list with what the raider wears of it. Copies, not ids: a BiS list
 * can name the same item twice (the shadow priest's T6 list wants Ring of
 * Recurrence in *both* finger slots), and owning one of them does not close the
 * second gap. So the worn items are counted and spent one per BiS entry.
 */
function bisItemsFor(bis, gear, bisTier) {
    const wornCount = new Map();
    for (const it of (gear && gear.items) || []) {
        const id = Number(it.itemId);
        wornCount.set(id, (wornCount.get(id) || 0) + 1);
    }
    return bis.items.map((entry) => {
        const id = Number(entry.id);
        const left = wornCount.get(id) || 0;
        if (left > 0) wornCount.set(id, left - 1);
        return { ...itemView(id, bisTier), owned: left > 0 };
    });
}

/**
 * One awarded item as the roster row lists it. `w` is what it counts as
 * ({ weight, cls } from services/loot/itemWeights.js), resolved against the
 * recipient's BiS list.
 */
function awardedItemView(it, w = { weight: 1, cls: "normal" }) {
    return {
        weight: w.weight,
        weightClass: w.cls,
        itemId: it.itemId,
        // The import fills the name in (enrichItemNames), but a row from
        // before that existed — or one Wowhead was unreachable for —
        // carries none. The item table answers for anything a caster can
        // wear, which is every row this page shows.
        itemName: it.itemName || (wowsims.item(it.itemId) || {}).name || `Item ${it.itemId}`,
        itemIconUrl: it.itemIconUrl,
        itemQuality: typeof it.itemQuality === "number" ? it.itemQuality : null,
        // Where the piece goes, so the comparison matrix can order its
        // rows like a character sheet. The first slot of a doubled one
        // (ring, trinket); -1 when the item table does not know it.
        slot: firstSlotFor(it.itemId),
        slotName: slotNameFor(it.itemId),
        contentId: it.contentId,
        tier: (contentMeta(it.contentId) || {}).tier || "",
        boss: it.boss || "",
        reason: it.reason || "",
        reasonLabel: it.reasonLabel || "",
        reasonTone: it.reasonTone || "",
        awardedAt: it.awardedAt || 0,
        eventLabel: it.eventLabel || "",
    };
}

/** The raider's last seen gear as the roster row carries it (null without any). */
function rosterGearView(gear, specEntry, bisIds, bisTier) {
    if (!gear) return null;
    return {
        seenAt: gear.seenAt,
        reportId: gear.reportId,
        reportTitle: gear.reportTitle,
        itemCount: gear.items.length,
        // The hit that counts for this spec, and its cap: spell hit for a
        // caster, physical hit for melee, hunters and tanks (`hitStat`), none
        // for a healer (hitCap 0 — the page then shows no hit badge).
        hit: gearHit(gear, hitStatFor(specEntry)),
        hitStat: hitStatFor(specEntry),
        hitCap: hitCapFor(specEntry),
        // Whether this really is the raider's damage kit. A shaman who
        // healed last night would otherwise be judged on healing gear:
        // no DPS worth the name, and every drop "replacing" a healing
        // piece it has nothing to do with.
        setRole: (gear.profile || {}).role || "",
        setConfident: !!(gear.profile || {}).confident,
        // True when *every* recent log showed the wrong role — the page
        // says so instead of quietly comparing against healing gear.
        roleMismatch: !!gear.roleMismatch,
        // How many newer raids were passed over to find a fitting set,
        // so "Gear-Stand" can explain why it is not the last raid.
        skippedReports: gear.skippedReports || 0,
        // Slots still held by a boss-specific piece (no older raid
        // showed anything else there) and slots filled from an older
        // raid instead of one. Both are counted for the page's stamp —
        // silently comparing against gear nobody wears on a normal
        // night is precisely what this is here to prevent.
        // Woher das Set stammt — die Auswertung oder die Armory. Ohne
        // das liest sich ein Gear-Stand von „gerade eben" wie ein Log
        // von gerade eben, und das wäre eine Lüge über die Herkunft.
        source: gear.source || "log",
        armoryAt: gear.armoryAt || 0,
        // Ein von Hand geladenes Log (source "wcl"): wann es geholt
        // wurde, und — wenn es nicht genommen wurde — warum nicht.
        wclAt: gear.wclAt || 0,
        logRejected: gear.logRejected || "",
        unverifiedEnchants: gear.unverifiedEnchants || 0,
        // Warum die Armory-Antwort nicht genommen wurde, obwohl es
        // eine gibt: "pvp" (Arenaset) oder "role" (Heilset für einen
        // Caster). Dann gilt weiter das Set aus dem letzten Raid.
        armoryRejected: gear.armoryRejected || "",
        // Jede der letzten Auswertungen zeigt PvP-Gear — dann wird es
        // gezeigt, aber gesagt.
        pvpGear: !!gear.pvpGear,
        situational: gear.items.filter((it) => it.situational).length,
        substituted: gear.items.filter((it) => it.replacedSituational).length,
        // Boss-specific pieces that were taken out of the set because
        // nothing could say what the raider wears there otherwise. The
        // slot is empty on purpose, and the page says which and why —
        // showing the piece would claim gear they do not have for the
        // boss anybody is planning for.
        dropped: (gear.dropped || []).map((it) => ({
            slot: it.slot,
            slotName: it.slotName,
            itemId: it.itemId,
            itemName: it.itemName,
            iconUrl: it.iconUrl,
            note: it.note,
        })),
        // The worn pieces themselves, in character-sheet order, so the
        // page can show the raider's gear as a row of icons. Whether a
        // piece is on their BiS list is decided here rather than in the
        // client, which has no BiS list per raider to check against.
        items: gear.items.map((it) => wornItemView(it, bisIds, bisTier)),
    };
}

/** The BiS block of a roster row. */
function bisView(bis, bisItems) {
    return {
        tier: bis.tier,
        exact: bis.exact,
        borrowedFrom: bis.borrowedFrom,
        // Woher die Liste stammt. Eine geschriebene Wowhead-Liste nennt
        // keine Sockel und keine Verzauberungen, und das ist etwas
        // anderes als ein simuliertes Set — die Zeile sagt es dazu.
        source: bis.source || "",
        sourceLabel: bis.sourceLabel || "",
        total: bisItems.length,
        owned: bisItems.filter((i) => i.owned).length,
        items: bisItems,
    };
}

/**
 * Class and spec of one character. Three sources from the data, and all three
 * are needed: characterInfo only annotates raiders who appear in the loot
 * history, so a raider who has never won anything — exactly the case this page
 * exists for — would have no spec and be dropped as "no council spec". The
 * character store knows them from the log evaluations, and the report's own
 * roster still knows at least the class. In a category with a roster (#667)
 * the member's profile character comes last (`ctx.hints`, councilRosterSource.js):
 * the one source that knows a new raider nobody has logged yet.
 */
function classAndSpec(key, ctx) {
    const known = ctx.info.get(key) || ctx.charStore[key] || {};
    const gear = ctx.gearMap.get(key) || null;
    const hint = (ctx.hints && ctx.hints.get(key)) || null;
    const className = known.className || (gear && gear.className) || (hint && hint.className) || "";
    let spec = known.spec || "";
    if (!spec && hint && hint.className === className) {
        // The profile can name several specs: the one of the role asked for, else the first the council knows.
        const fits = hint.specs.filter((s) => specFor(className, s));
        spec = fits.find((s) => !ctx.role || specFor(className, s).role === ctx.role) || fits[0] || "";
    }
    return { gear, hint, className, spec };
}

/**
 * One raider's roster row, or null when they are not on the council (no
 * council spec, or not the role asked for). `ctx` is what councilRoster
 * loaded once: `{ info, charStore, gearMap, loot, planned, role, bisTier, now, links, hints }`.
 */
function rosterRow(key, ctx) {
    const { gear, hint, className, spec } = classAndSpec(key, ctx);
    const fromData = specFor(className, spec);
    if (!fromData) return null;
    // Die Festlegung des Raidleads gewinnt, wenn die Klasse sie hergibt —
    // ein Paladin lässt sich nicht als Caster einplanen, ein Magier nicht als
    // Tank; dann bleibt es bei dem, was die Daten sagen.
    const wanted = ctx.planned.get(key) || "";
    const specEntry = (wanted && wanted !== fromData.role && specForRole(className, wanted)) || fromData;
    if (ctx.role && specEntry.role !== ctx.role) return null;

    const bucket = ctx.loot.get(key) || { all: [], filtered: [], other: 0, character: "" };
    const filtered = bucket.filtered.sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
    const lastAwardAt = filtered.length ? filtered[0].awardedAt : 0;
    const daysSinceLoot = lastAwardAt ? Math.floor((ctx.now - lastAwardAt) / DAY) : null;
    const bis = bisForSpec(specEntry, ctx.bisTier);
    const bisItems = bisItemsFor(bis, gear, ctx.bisTier);
    const bisIds = new Set(bis.items.map((entry) => Number(entry.id)));
    // What each award counts as (#668): its weight decides the loot points and
    // how far it reset the wait. A weapon is a BiS weapon against *this*
    // raider's list.
    const weighed = filtered.map((it) => ({ it, w: itemWeight(it.itemId, ctx.weights, { bisIds, itemName: it.itemName }) }));
    const lootPoints = Math.round(weighed.reduce((n, x) => n + x.w.weight, 0) * 10) / 10;
    const joined = ctx.joinedAtFor(key);

    const look = classLook(ctx.charStore, key);
    const character = bucket.character || (gear && gear.character) || (hint && hint.name) || key;
    return {
        key,
        character,
        className,
        classColor: look.classColor,
        specIconUrl: look.specIconUrl,
        // The gear on this page is *last seen in a log*, never live. One
        // click to the armory is what makes that checkable instead of
        // something a council has to take on trust.
        armoryUrl: ctx.links.armory(character),
        spec,
        specKey: specEntry.key,
        specLabel: specEntry.label,
        specAssumed: !!specEntry.assumedFromClass,
        // Als was jemand eingeplant ist, und ob das eine Festlegung war
        // oder aus den Daten folgt. `roleOptions` sagt der Seite, ob es
        // überhaupt etwas zu wählen gibt — bei einem Magier nicht.
        roleOverride: specEntry.role === wanted ? wanted : "",
        roleFromData: fromData.role,
        roleOptions: rolesForClass(className),
        role: specEntry.role,
        lootCount: filtered.length,
        // The same awards weighed by item class (#668): what the share part
        // compares, shown as "3 Items · 5,5 Punkte".
        lootPoints,
        lootTotal: bucket.all.length,
        // Off-spec rolls, shards and bank items: they exist, but they did
        // nothing for this raider's set, so they do not count towards what
        // they have already been given (see countsAsLoot).
        otherCount: bucket.other || 0,
        lastAwardAt,
        daysSinceLoot,
        // The wait as it counts: small items reset it only partly (droughtDays).
        droughtDays: droughtDays(weighed.map((x) => ({ awardedAt: x.it.awardedAt, weight: x.w.weight })), daysSinceLoot),
        // "Dabei seit" (councilTenure.js): the date, where it came from, and
        // the whole days since — 0 / "" when nothing is known.
        joinedAt: joined.joinedAt,
        joinedFrom: joined.source,
        tenureDays: tenureDaysOf(joined.joinedAt, ctx.now),
        items: weighed.map((x) => awardedItemView(x.it, x.w)),
        gear: rosterGearView(gear, specEntry, bisIds, ctx.bisTier),
        bis: bisView(bis, bisItems),
        simSupported: isSimSupported(specEntry),
    };
}

/**
 * The need score of every row. The share component needs the field it is
 * measured against, so it is added once the whole roster is known. Returns the
 * field's average loot count.
 */
function scoreRows(rows, weights = resolveWeights()) {
    const avg = rows.length ? rows.reduce((n, r) => n + r.lootCount, 0) / rows.length : 0;
    // The share compares loot points, not item counts (#668).
    const avgPoints = rows.length ? rows.reduce((n, r) => n + (r.lootPoints || 0), 0) / rows.length : 0;
    for (const row of rows) {
        const { score, parts } = needScore({
            droughtDays: row.droughtDays,
            lootPoints: row.lootPoints,
            avgLootPoints: avgPoints,
            bisOwned: row.bis.owned,
            bisTotal: row.bis.total,
            tenureDays: row.tenureDays,
        }, weights.needShares, weights.tenureDays);
        row.needScore = score;
        row.needParts = parts;
    }
    return { avg, avgPoints };
}

/**
 * The council roster: every raider with a council spec (caster, healer, tank,
 * melee, hunter — config/councilSpecs.js) and loot history or known gear —
 * or, for a category with a roster (#667), the roster's Stamm and Probe
 * (plus Ersatz with `showBench`), with or without loot and gear.
 *
 * @param {object} opts
 *   role        "caster" | "healer" | "tank" | "melee" | "ranged" | "" (all)
 *   tierIds     tier ids to count loot from ([] = all)
 *   contentIds  extra content ids to count loot from
 *   categoryId  restrict to one raid category (the Monday raid, say)
 *   bisTier     which tier's BiS list to measure against
 *               (default: the tier the guild's newest loot comes from)
 *   showBench   with a roster: Ersatz (bench) members are candidates too
 *   charVersion restrict to raiders of one game version (#545, "" = every
 *               version) — a character's version like the roster derives it
 *               (services/characters/characterVersions.js): its own when
 *               known, else the version of an own event it won loot in, else
 *               its category's, else TBC.
 */
function councilRoster(opts = {}) {
    const { role = "", categoryId = "", charVersion = "" } = opts;
    const contentFilter = resolveContentFilter(opts);
    const info = new Map(annotatedCharacters().map((c) => [c.key, c]));
    const { roleByKey, planned } = judgedRoles();
    const gearMap = gearByCharacter({ roleFor: (key) => roleByKey.get(key) || "" });
    // Class colour and spec icon are resolved server-side, like everywhere else
    // in the app — the client never keeps a second copy of the WoW palette.
    const charStore = characterMap();
    const now = Date.now();

    const allLoot = listAll();
    const bisTier = opts.bisTier || currentTier(allLoot);
    const loot = lootByCharacter(allLoot, categoryId, contentFilter);

    // A category with a roster (#667): the roster IS the candidate list —
    // Stamm and Probe, Ersatz with `showBench`, every assigned character. Its
    // members appear even with no loot and no gear (0 items, the longest wait).
    // A roster picked on the page (#676, `rosterId`) may have no category at all.
    const fromRoster = rosterCandidates(categoryId, { showBench: !!opts.showBench, rosterId: opts.rosterId || "" });

    // Without one: everyone who could be on the council, known from loot, from
    // a CLA report, or from both. A raider who has never won an item still
    // belongs on the list — they are precisely the case the council is looking for.
    const keys = fromRoster ? new Set(fromRoster.candidates) : new Set([...loot.keys(), ...gearMap.keys()]);

    // The category filter narrows *who is on the list*, not just which of their
    // items count. Filtering the loot alone left every other raid's casters
    // standing there with "0 Items" and a maximum drought — and therefore on
    // top of the very ranking the page is for. With a roster it no longer
    // decides who is on the list; it finds who stood there without being in it.
    const members = categoryMembers(categoryId, allLoot);
    // Raiders the council has stopped planning with. Excluded rather than
    // deleted, so the loot history stays whole and the decision is reversible.
    const excluded = excludedKeys();

    // One read of the version's links for every row (#542): the category's version, else the main one.
    const links = versionLinks(opts.versionId);
    // Every candidate's game version (#545), read once — cheap (no network),
    // so it is always known: the version filter's own choices come from it
    // (every version a candidate of this category has, plus the main one),
    // and the same values decide who the charVersion filter keeps.
    const versionCtx = buildVersionContext({ config: opts.config });
    const mainVersion = opts.mainVersion || mainVersionFor({ config: opts.config });
    // How items and the need parts weigh (#668): the profile of the roster or
    // category (#676, services/loot/councilProfiles.js), else the default
    // profile; `opts.weights` lets a caller (a test) pass them in.
    const weights = resolveWeights(opts.weights || councilProfiles.weightsFor({ rosterId: opts.rosterId || "", categoryId }));
    // "Dabei seit" per raider, read once for the whole roster.
    const joinedAtFor = opts.joinedAtFor || tenureContext({ categoryId, allLoot, now });
    const ctx = {
        info, charStore, gearMap, loot, planned, role, bisTier, now, links, weights, joinedAtFor,
        hints: fromRoster ? fromRoster.entries : null,
    };
    const rows = [];
    const seenVersions = [];
    const skipped = { category: 0, excluded: 0, version: 0, ...rosterSkipped(fromRoster) };
    // Roster members whose spec the council does not know (yet): counted and
    // named rather than left out silently.
    const noSpec = [];
    for (const key of keys) {
        if (!fromRoster && members && !members.keys.has(key)) { skipped.category += 1; continue; }
        if (excluded.has(key)) { skipped.excluded += 1; continue; }
        // A roster member's version is the roster's; everyone else's is derived.
        const versionIds = fromRoster ? [fromRoster.roster.versionId] : derivedVersions(key, { info, loot, versionCtx });
        seenVersions.push({ versionIds });
        if (charVersion && !versionIds.includes(charVersion)) { skipped.version += 1; continue; }
        const row = rosterRow(key, ctx);
        const entry = fromRoster ? fromRoster.entries.get(key) : null;
        if (row) {
            // The roster status as information (only with a roster - without
            // one the rows stay exactly as before): the page shows Probe/Ersatz
            // as a badge, and the addon will carry it (#670).
            if (entry) row.status = entry.status;
            rows.push(row);
        } else if (entry) {
            // Left out by the role filter is not "unknown spec".
            const { className, spec } = classAndSpec(key, ctx);
            if (!specFor(className, spec)) {
                noSpec.push({ key, character: entry.name || key, className, status: entry.status });
            }
        }
    }

    const { avg, avgPoints } = scoreRows(rows, weights);
    rows.sort((a, b) => b.needScore - a.needScore || a.character.localeCompare(b.character));
    // bisTier goes back out so the page can show which list it is measuring
    // against — especially when nobody picked one and it was derived. The
    // skipped counts let the page say *why* a name is missing, which is the
    // difference between a working filter and a page that looks broken.
    return {
        rows,
        avgLootCount: Math.round(avg * 10) / 10,
        avgLootPoints: Math.round(avgPoints * 10) / 10,
        // The weighting the numbers were computed with — the need bar is
        // stacked in exactly these shares.
        weights: weightsView(weights),
        bisTier,
        // The version filter's own choices (#545): every version a candidate
        // of this category has, plus the main version even with none.
        versions: versionChoices(seenVersions, mainVersion),
        skipped,
        // How the category filter knew who belongs: from the maintained
        // assignment, or only from who won loot there (which cannot see a
        // raider who never won anything).
        // What each source contributed, so an empty list can be explained
        // rather than looking like a bug.
        categorySources: members ? members.sources : null,
        // With a roster only (#667) - without one the answer is unchanged:
        //   rosterSource  which roster, how many per status, whether Ersatz is
        //                 shown, and who it holds without a council spec;
        //   outsiders     who stood in this category's logs or loot without
        //                 being in its roster - stand-ins. Shown folded, never
        //                 ranked, never in the addon (councilSync.js reads `rows` only).
        ...(fromRoster ? {
            rosterSource: {
                id: fromRoster.roster.id,
                name: fromRoster.roster.name,
                versionId: fromRoster.roster.versionId,
                counts: fromRoster.counts,
                showBench: fromRoster.showBench,
                noSpec,
            },
            outsiders: rosterOutsiders(members, fromRoster, excluded, ctx),
        } : {}),
    };
}

/** The roster's own skip counts: Ersatz while hidden, Pause always (it counts like "Nicht eingeplant"). */
function rosterSkipped(fromRoster) {
    if (!fromRoster) return {};
    return { bench: fromRoster.showBench ? 0 : fromRoster.counts.bench, paused: fromRoster.counts.pause };
}

/** A character's game versions (#545) when no roster says it: characterVersions.js. */
function derivedVersions(key, { info, loot, versionCtx }) {
    const known = info.get(key) || {};
    const bucket = loot.get(key);
    return versionsOfCharacter(versionCtx, {
        name: known.character || (bucket && bucket.character) || key,
        items: (bucket && bucket.all) || [],
        categoryIds: known.categoryIds || [],
    });
}

/**
 * The stand-ins of a category with a roster: characters the logs or the loot
 * of this category know (categoryMembers) who are in the roster under no
 * status, and not set aside. Rows like the roster's, without a need score —
 * they are not ranked — most loot first.
 */
function rosterOutsiders(members, fromRoster, excluded, ctx) {
    const out = [];
    for (const key of (members && members.keys) || []) {
        if (fromRoster.entries.has(key) || excluded.has(key)) continue;
        const row = rosterRow(key, ctx);
        if (!row) continue;
        row.status = "";
        out.push(row);
    }
    return out.sort((a, b) => b.lootCount - a.lootCount || a.character.localeCompare(b.character));
}

/**
 * The gear of everyone on the roster, read once.
 *
 * Same role gate as the roster itself: a drop must not be weighed against the
 * healing set somebody wore on Thursday. The roster rows already carry the spec
 * each raider is judged as, so this needs no second lookup.
 */
function rosterGear(roster) {
    const roleByKey = new Map(roster.map((r) => [r.key, (specByKey(r.specKey) || {}).role || ""]));
    return gearByCharacter({ roleFor: (key) => roleByKey.get(key) || "" });
}

/**
 * For one item: who on the roster can wear it, what it would replace, and how
 * much it would be worth to each of them by stat weights — plus who *cannot*
 * wear it, and why.
 *
 * The list is the answer to the question a council actually asks — "this just
 * dropped, who gets it?" — so it keeps raiders the item is a *downgrade* for
 * too, marked as such: knowing that it helps nobody is an answer.
 *
 * ⚠️ A raider who cannot equip the item is never a candidate: a warlock's tier
 * helm is not "a downgrade" for a mage, it is not theirs to take, and offering
 * it would let a council hand it out. `unwearable` names them with the reason
 * (config/wearable.js), so a shorter list is explained rather than puzzling.
 *
 * `value` is the stat-weight ordering and nothing more — the page shows no
 * estimated gain, only a simulated one — but it still decides which candidate
 * is listed first while nothing is simulated yet.
 *
 * ⚠️ `gearMap` is the roster's gear, and it must be handed in whenever this is
 * asked for more than one item: building it reads every stored evaluation from
 * disk, so the BiS overview — which asks per item — paid that price once per
 * gap and took minutes on a real guild's data.
 *
 * @returns {{candidates: object[], unwearable: object[]}}
 */
function candidateSplit(itemId, roster, gearMap = rosterGear(roster)) {
    const item = wowsims.item(itemId);
    if (!item) return { candidates: [], unwearable: [] };
    const out = [];
    const unwearable = [];
    for (const row of roster) {
        const specEntry = specByKey(row.specKey);
        const fit = wearCheck(row.className, itemId, { spec: (specEntry && specEntry.spec) || row.spec || "" });
        if (!fit.ok) {
            unwearable.push({
                key: row.key,
                character: row.character,
                classColor: row.classColor,
                specKey: row.specKey,
                specLabel: row.specLabel,
                specIconUrl: row.specIconUrl,
                reason: fit.reason,
                note: fit.note,
            });
            continue;
        }
        const gear = gearMap.get(row.key) || null;
        const target = targetSlotFor(gear, itemId);
        if (!target) continue; // the item fits no slot this raider has
        const bisIds = new Set(row.bis.items.map((i) => i.id));
        const asWorn = (it) => wornItemView(it, bisIds, row.bis.tier);
        // A two-hander costs the off-hand piece on top of the main-hand one, so
        // the value has to be measured against both — scoring it against the
        // main hand alone would overstate every staff.
        const value = target.displaces.reduce(
            (sum, off, i) => sum - (i === 0 ? 0 : scoreItem(off.itemId, weightsFor(specEntry))),
            upgradeValue({ gear, specEntry, itemId, replaces: target.replaces }),
        );
        const isBis = row.bis.items.some((i) => i.id === Number(itemId));
        // Not BiS for this raider: they are still a candidate, but a weighted
        // one — half the need, half the gain in every ordering — so the raider
        // it *is* BiS for is preferred unless the difference is large.
        const bisWeight = isBis ? 1 : NON_BIS_WEIGHT;
        // A baseline the comparison cannot read: what would come off carries no
        // stats at all — a situational trinket the substitution could not
        // replace, a relic, an off-spec piece — so both the stat weights and the
        // simulation measure against an empty slot and credit this raider the
        // item's *full* worth while everyone else only gets the difference. The
        // gain is not wrong, the comparison is; the council is told which.
        // "No stats" rather than "not in the table": the table carries
        // effect-only trinkets and relics precisely so they can be handed out,
        // and their empty stat block reads as an empty slot all the same.
        const unreadable = target.displaces.filter((off) => off && !hasStats(off.itemId));
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
            slotName: SLOT_NAMES[target.slot] || `Slot ${target.slot}`,
            // The full view of what would come off, not just its name: a council
            // deciding on a drop wants to see the piece it replaces — icon,
            // item level, whether it is enchanted, whether it was on that
            // raider's BiS list.
            replaces: target.replaces ? asWorn(target.replaces) : null,
            // Every slot that was in play, so the page can show *both* rings or
            // *both* hands rather than only the one that happens to lose out.
            // `chosen` marks the slot the item lands in — for a two-hander that
            // is both, because it takes both.
            slotOptions: target.options.map((opt) => ({
                slot: opt.slot,
                slotName: SLOT_NAMES[opt.slot] || `Slot ${opt.slot}`,
                chosen: opt.chosen,
                item: opt.item ? asWorn(opt.item) : null,
            })),
            // True when accepting the item costs more than one piece — a
            // two-handed weapon also empties the off hand.
            twoHanded: (target.clears || []).length > 0,
            value,
            // Why the gain is not comparable to the others', named so the page
            // can say it rather than showing a bare warning triangle.
            inflatedBy: unreadable.map((off) => ({
                itemName: off.itemName || `Item ${off.itemId}`,
                note: (off.situational || {}).note || "trägt keine passenden Werte, zählt im Vergleich wie ein leerer Slot",
            })),
            isBis,
            bisWeight,
            // The need as it counts for *this* item: the raider's need score
            // times the BiS weight. The raw need stays beside it, so the bar
            // can still show the fairness numbers unchanged.
            itemNeedScore: Math.round(row.needScore * bisWeight * 1000) / 1000,
            // The fairness half of the decision, carried alongside the gear
            // gain rather than folded into it: "who would gain most" and "who
            // has waited longest" are two different questions, and a council
            // that only ever sees them multiplied together cannot weigh them
            // against each other. Same numbers as the roster table, so a name
            // cannot look overdue in one view and satisfied in the other.
            needScore: row.needScore,
            needParts: row.needParts,
            lootCount: row.lootCount,
            lootPoints: row.lootPoints,
            lootTotal: row.lootTotal,
            droughtDays: row.droughtDays,
            tenureDays: row.tenureDays,
            joinedAt: row.joinedAt,
            otherCount: row.otherCount,
            // What they were actually given lately, so "4 Items" can be opened
            // up on the spot. A council arguing about a drop asks "ja was hat
            // der denn schon bekommen?" in the same breath — sending them to
            // another tab for the answer is how a decision stalls.
            recentItems: row.items.slice(0, RECENT_ITEMS),
            daysSinceLoot: row.daysSinceLoot,
            lastAwardAt: row.lastAwardAt,
            bisOwned: row.bis.owned,
            bisTotal: row.bis.total,
            hasGear: !!gear,
            simSupported: row.simSupported,
            // The full worn set and where it comes from (Auswertung/Log/Armory,
            // PvP-Gear, rejected reload) — already built for the roster row, so
            // the drop check can show it without opening the raider's dialog.
            gear: row.gear,
        });
    }
    // Biggest weighted gear gain first (a non-BiS candidate's value counts
    // half); the weighted need only breaks ties, because a council weighs
    // fairness itself and should see the raw upgrade unblurred.
    out.sort((a, b) => b.value * b.bisWeight - a.value * a.bisWeight || b.itemNeedScore - a.itemNeedScore);
    return { candidates: out, unwearable };
}

/** The candidates alone — everyone on the roster who can wear the item. */
function candidatesForItem(itemId, roster, gearMap) {
    return candidateSplit(itemId, roster, gearMap).candidates;
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
    // Once for the whole list, not once per gap: this reads every stored
    // evaluation, and a real guild's overview holds a hundred gaps.
    const gearMap = rosterGear(roster);
    for (const item of items) {
        item.candidates = candidatesForItem(item.id, roster, gearMap);
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
        bisTiers: TIERS.filter((t) => bisSource.specsWithBis().some((s) => bisSource.bisTiers(s).includes(t.id))),
    };
}

module.exports = {
    councilRoster, candidateSplit, bisGaps, filterOptions, bisSpecsView, resolveContentFilter, itemView, NEED_WEIGHTS,
    DROUGHT_DAYS, droughtCounter,
    // only for the tests (#424): not part of the module's API
    _internal: {
        candidatesForItem, currentTier, wornItemView, NEED_WEIGHTS, NON_BIS_WEIGHT, upgradeValue, needScore, gearHit, firstSlotFor,
        slotNameFor, droughtDays, resolveWeights,
    },
};
