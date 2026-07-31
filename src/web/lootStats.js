// The two cross-raid loot overviews: "who got what and why" and "who got this
// item". Both read the same decorated loot rows (see lootStore.decorate — the
// award reason and the raid an item comes from are added there), so they can
// never disagree about a row's reason or content.
//
// Everything is aggregated in one pass here rather than in the route, because
// the numbers are what gets tested: the route only adds class colours and icons.

const { listAll, charLootPreview } = require("./lootStore");
const { annotatedCharacters } = require("./characterInfo");
const { reasonCatalog, reasonMeta } = require("../utils/lootReasons");
const { CONTENTS, TIERS, content: contentMeta } = require("../config/tbcContent");

// The one response wording shared by every item of a bucket, or "" when they
// differ (or none carries one).
function soleResponse(items) {
    const responses = items.map((it) => String(it.response || "").trim());
    // One item without a wording is enough to fall back — the label has to
    // cover every item in the bucket, not most of them.
    if (!responses.length || responses.some((r) => !r)) return "";
    const distinct = new Set(responses);
    return distinct.size === 1 ? responses[0] : "";
}

/**
 * Per raider: how their loot splits across the award reasons, with the items
 * behind every bucket so the badge can list them on hover.
 *
 * Class/spec come from characterInfo (the same annotated list the Charaktere
 * tab uses) — a raider whose class is still unknown is kept, since hiding them
 * would silently shrink the totals.
 *
 * @returns [{ key, character, realm, className, spec, count,
 *             reasons: [{ reason, label, tone, count, items: [...] }] }]
 */
function reasonsByCharacter() {
    const info = new Map(annotatedCharacters().map((c) => [c.key, c]));
    const byChar = new Map();
    for (const it of listAll()) {
        const key = it.characterKey;
        if (!key) continue;
        if (!byChar.has(key)) {
            const known = info.get(key) || {};
            byChar.set(key, {
                key,
                character: it.character,
                realm: it.realm || "",
                className: known.className || "",
                spec: known.spec || "",
                categoryIds: new Set(),
                count: 0,
                buckets: new Map(),
            });
        }
        const c = byChar.get(key);
        c.count += 1;
        if (it.categoryId) c.categoryIds.add(it.categoryId);
        if (!c.buckets.has(it.reason)) c.buckets.set(it.reason, []);
        c.buckets.get(it.reason).push(charLootPreview(it));
    }

    return [...byChar.values()]
        .map((c) => ({
            key: c.key,
            character: c.character,
            realm: c.realm,
            className: c.className,
            spec: c.spec,
            categoryIds: [...c.categoryIds],
            count: c.count,
            reasons: [...c.buckets.entries()]
                .map(([reason, items]) => {
                    const meta = reasonMeta(reason);
                    return {
                        reason: meta.id,
                        // Labelled with the guild's own wording when the bucket
                        // has exactly one — a guild that named its button
                        // "Zweitspec" should read "Zweitspec", not the internal
                        // "Offspec". Mixed wordings fall back to the bucket
                        // name, the only thing they have in common.
                        label: soleResponse(items) || meta.label,
                        reasonLabel: meta.label,
                        tone: meta.tone,
                        order: meta.order,
                        count: items.length,
                        items,
                    };
                })
                // Strongest reason first, so the green badges lead the row and
                // the leftovers trail it — same order everywhere (see REASONS).
                .sort((a, b) => a.order - b.order),
        }))
        .sort((a, b) => b.count - a.count || a.character.localeCompare(b.character));
}

// One award of one item, as the item table's raider badge needs it: who got it,
// when, in which raid and for what reason.
function award(it, known) {
    return {
        character: it.character,
        characterKey: it.characterKey,
        className: known.className || "",
        spec: known.spec || "",
        reason: it.reason,
        reasonLabel: it.reasonLabel,
        reasonTone: it.reasonTone,
        response: it.response || "",
        eventId: it.eventId || "",
        eventLabel: it.eventLabel || "",
        categoryId: it.categoryId || "",
        awardedAt: it.awardedAt || 0,
        source: it.source || "",
    };
}

/**
 * Every item that was ever looted, once per item id, with all its awards. The
 * content ("ssc", "tk", …) and the tier come from the item id, so a Gargul
 * import — which carries nothing but that id — is filtered exactly like an
 * RCLootcouncil one. Items the content table doesn't know keep contentId "" and
 * show up under "Unbekannt" instead of being filed into a wrong raid.
 *
 * `categoryIds` are the raid categories (Mainraid, Twinkraid, …) the item was
 * ever handed out in — the Items tab filters by them the same way the
 * Loot-Gründe tab does.
 *
 * @returns [{ itemId, itemName, itemIconUrl, itemQuality, itemLink, contentId,
 *             tier, boss, tokenTier, categoryIds, count, lastAwardedAt,
 *             awards: [...] }]
 */
function itemCatalog() {
    const info = new Map(annotatedCharacters().map((c) => [c.key, c]));
    const byItem = new Map();
    for (const it of listAll()) {
        const id = Number(it.itemId) || 0;
        if (!id) continue;
        if (!byItem.has(id)) {
            byItem.set(id, {
                itemId: id,
                itemName: it.itemName || "",
                itemIconUrl: it.itemIconUrl || "",
                // null (not 0) when Wowhead never resolved it — 0 is "poor".
                itemQuality: typeof it.itemQuality === "number" ? it.itemQuality : null,
                itemLink: it.itemLink || "",
                contentId: it.contentId || "",
                tier: (contentMeta(it.contentId) || {}).tier || "",
                boss: it.boss || "",
                tokenTier: it.tokenTier || "",
                categoryIds: new Set(),
                count: 0,
                lastAwardedAt: 0,
                awards: [],
            });
        }
        const entry = byItem.get(id);
        // Rows of the same item can be unequally filled in (an early Gargul
        // import has no name, a later RCLootcouncil one has); take whatever is
        // there rather than whichever row happened to come first.
        if (!entry.itemName && it.itemName) entry.itemName = it.itemName;
        if (!entry.itemIconUrl && it.itemIconUrl) entry.itemIconUrl = it.itemIconUrl;
        if (entry.itemQuality === null && typeof it.itemQuality === "number") entry.itemQuality = it.itemQuality;
        if (!entry.boss && it.boss) entry.boss = it.boss;
        if (it.categoryId) entry.categoryIds.add(it.categoryId);
        entry.count += 1;
        entry.lastAwardedAt = Math.max(entry.lastAwardedAt, it.awardedAt || 0);
        entry.awards.push(award(it, info.get(it.characterKey) || {}));
    }
    return [...byItem.values()]
        .map((e) => ({
            ...e,
            categoryIds: [...e.categoryIds],
            awards: e.awards.sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0)),
        }))
        .sort((a, b) => b.count - a.count || (a.itemName || "").localeCompare(b.itemName || ""));
}

/**
 * Everything the two overview tabs render: the aggregates plus the catalogs
 * (reasons, contents, tiers) they label and filter by. The client never
 * hard-codes a reason colour or a raid name — same rule the class colours
 * already follow.
 */
function lootStats() {
    const items = itemCatalog();
    // Only offer filters that actually match something — a dropdown full of
    // raids the guild has never set foot in is noise.
    const usedContents = new Set(items.map((i) => i.contentId).filter(Boolean));
    const usedTiers = new Set(items.map((i) => i.tier).filter(Boolean));
    return {
        reasons: reasonCatalog(),
        contents: CONTENTS.filter((c) => usedContents.has(c.id)),
        tiers: TIERS.filter((t) => usedTiers.has(t.id)),
        characters: reasonsByCharacter(),
        items,
        unknownContentCount: items.filter((i) => !i.contentId).length,
    };
}

module.exports = { reasonsByCharacter, itemCatalog, lootStats };
