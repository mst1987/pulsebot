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
const { countsAsLoot } = require("../utils/lootReasons");
const { getCategoryAssignments } = require("./raiderCharactersStore");
const { excludedKeys, plannedRoles } = require("./councilStore");
const { armoryUrlFor } = require("./charLinks");
const { characterKey, splitPlayer } = require("../utils/lootImport");
const { listRaidEvents } = require("./raidEventStore");
const { listLogs } = require("./logStore");
const { listReports, getReport } = require("./reportStore");
const { CONTENTS, TIERS, content: contentMeta, sourceForItem } = require("../config/tbcContent");
const { SLOT_NAMES } = require("../utils/logcheck/gearIssues");
const { characterProfile } = require("../utils/setupView");
const { targetSlotFor } = require("../utils/wowsims/loadout");
const wowsims = require("../config/wowsims");
const bisSource = require("../config/bisSets");
const {
    ROLES, specFor, specByKey, specForRole, rolesForClass, weightsFor, hitCapFor,
    bisForSpec, isSimSupported, bisSpecsForItem,
} = require("../config/casterSpecs");

const DAY = 24 * 60 * 60 * 1000;

// How many recent awards ride along on a candidate. Enough to answer "was hat
// der schon bekommen?" in a hover, few enough that the panel needs no scrolling
// — the character page has the full history.
const RECENT_ITEMS = 8;

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
        listRaidEvents()
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
        const report = getReport(meta.id);
        for (const entry of (report && report.roster) || []) {
            const key = characterKey(splitPlayer(entry.name).character);
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
    // Which role each raider is judged as, so a night spent healing does not
    // become their DPS gear (see charGear.js). Resolved from the same sources
    // the roster rows use, one pass ahead of them.
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
    const gearMap = gearByCharacter({ roleFor: (key) => roleByKey.get(key) || "" });
    // Class colour and spec icon are resolved server-side, like everywhere else
    // in the app — the client never keeps a second copy of the WoW palette.
    const charStore = characterMap();
    const now = Date.now();

    const allLoot = listAll();
    const bisTier = opts.bisTier || currentTier(allLoot);

    // Loot per character, split into "counts for the filter" and "all of it".
    //
    // The category narrows which items *count* — a raider assigned to Monday
    // who only ever won something on Thursday belongs in the Monday list with
    // zero items, not out of it. Who is on the list at all is decided below.
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

    // Everyone who could be on the council: known from loot, from a CLA report,
    // or from both. A raider who has never won an item still belongs on the
    // list — they are precisely the case the council is looking for.
    const keys = new Set([...loot.keys(), ...gearMap.keys()]);

    // The category filter narrows *who is on the list*, not just which of their
    // items count. Filtering the loot alone left every other raid's casters
    // standing there with "0 Items" and a maximum drought — and therefore on
    // top of the very ranking the page is for.
    const members = categoryMembers(categoryId, allLoot);
    // Raiders the council has stopped planning with. Excluded rather than
    // deleted, so the loot history stays whole and the decision is reversible.
    const excluded = excludedKeys();

    const rows = [];
    const skipped = { category: 0, excluded: 0 };
    for (const key of keys) {
        if (members && !members.keys.has(key)) { skipped.category += 1; continue; }
        if (excluded.has(key)) { skipped.excluded += 1; continue; }
        // Three sources for class and spec, and all three are needed:
        // characterInfo only annotates raiders who appear in the loot history,
        // so a raider who has never won anything — exactly the case this page
        // exists for — would have no spec and be dropped as "not a caster".
        // The character store knows them from the log evaluations, and the
        // report's own roster still knows at least the class.
        const known = info.get(key) || charStore[key] || {};
        const gear = gearMap.get(key) || null;
        const className = known.className || (gear && gear.className) || "";
        const fromData = specFor(className, known.spec);
        if (!fromData) continue;
        // Die Festlegung des Raidleads gewinnt, wenn die Klasse sie hergibt —
        // ein Paladin lässt sich nicht als Caster einplanen, dann bleibt es bei
        // dem, was die Daten sagen.
        const wanted = planned.get(key) || "";
        const specEntry = (wanted && wanted !== fromData.role && specForRole(className, wanted)) || fromData;
        if (role && specEntry.role !== role) continue;

        const bucket = loot.get(key) || { all: [], filtered: [], other: 0, character: "" };
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
        const character = bucket.character || (gear && gear.character) || key;
        rows.push({
            key,
            character,
            className,
            classColor: look.classColor,
            specIconUrl: look.specIconUrl,
            // The gear on this page is *last seen in a log*, never live. One
            // click to the armory is what makes that checkable instead of
            // something a council has to take on trust.
            armoryUrl: armoryUrlFor(character),
            spec: known.spec || "",
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
            lootTotal: bucket.all.length,
            // Off-spec rolls, shards and bank items: they exist, but they did
            // nothing for this raider's set, so they do not count towards what
            // they have already been given (see countsAsLoot).
            otherCount: bucket.other || 0,
            lastAwardAt,
            daysSinceLoot: lastAwardAt ? Math.floor((now - lastAwardAt) / DAY) : null,
            items: filtered.map((it) => ({
                itemId: it.itemId,
                // The import fills the name in (enrichItemNames), but a row from
                // before that existed — or one Wowhead was unreachable for —
                // carries none. The item table answers for anything a caster can
                // wear, which is every row this page shows.
                itemName: it.itemName || (wowsims.item(it.itemId) || {}).name || `Item ${it.itemId}`,
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
                unverifiedEnchants: gear.unverifiedEnchants || 0,
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
            } : null,
            bis: {
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
    // against — especially when nobody picked one and it was derived. The
    // skipped counts let the page say *why* a name is missing, which is the
    // difference between a working filter and a page that looks broken.
    return {
        rows,
        avgLootCount: Math.round(avg * 10) / 10,
        bisTier,
        skipped,
        // How the category filter knew who belongs: from the maintained
        // assignment, or only from who won loot there (which cannot see a
        // raider who never won anything).
        // What each source contributed, so an empty list can be explained
        // rather than looking like a bug.
        categorySources: members ? members.sources : null,
    };
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
    // Same role gate as the roster: the drop check must not weigh a caster's
    // upgrade against the healing set they wore on Thursday either. The roster
    // rows already carry the spec each raider is judged as, so it needs no
    // second lookup.
    const roleByKey = new Map(roster.map((r) => [r.key, (specByKey(r.specKey) || {}).role || ""]));
    const gearMap = gearByCharacter({ roleFor: (key) => roleByKey.get(key) || "" });
    const out = [];
    for (const row of roster) {
        const specEntry = specByKey(row.specKey);
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
        // A baseline the comparison cannot read: what would come off carries no
        // caster stats at all — a situational trinket the substitution could not
        // replace, a relic, an off-spec piece — so both the stat weights and the
        // simulation measure against an empty slot and credit this raider the
        // item's *full* worth while everyone else only gets the difference. The
        // gain is not wrong, the comparison is; the council is told which.
        const unreadable = target.displaces.filter((off) => off && !wowsims.item(off.itemId));
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
                note: (off.situational || {}).note || "trägt keine Casterwerte, zählt im Vergleich wie ein leerer Slot",
            })),
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
        bisTiers: TIERS.filter((t) => bisSource.specsWithBis().some((s) => bisSource.bisTiers(s).includes(t.id))),
    };
}

module.exports = {
    councilRoster, candidatesForItem, bisGaps, filterOptions, currentTier, wornItemView, bisSpecsView, categoryMembers,
    upgradeValue, needScore, scoreItem, gearSpellHit, resolveContentFilter, itemView,
};
