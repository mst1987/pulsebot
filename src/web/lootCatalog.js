// Which items can drop in which raid — the pick list behind "Item nachtragen".
//
// A loot import knows what dropped because the export says so. Adding a piece
// by hand has to work the other way round: the raid lead picks a raid, a boss
// and an item, and the only trustworthy list of what is even possible there is
// the drop table the loot classifier already uses (config/tbcContent.js's
// RAID_LOOT), named by config/tbcLootNames.js. Offering a free Wowhead search
// instead would let a Karazhan night be credited with a Sunwell weapon.
//
// The catalogue is static data, so it is built once and reused; the picker
// filters it client-side (a raid is 30-200 items — small enough to hand over in
// one response, and searching it then costs no round trip).
const { CONTENTS, RAID_LOOT, contentsForText, tier, bossOrder } = require("../config/tbcContent");
const { RAID_ITEMS } = require("../config/tbcLootNames");
const { iconUrl, itemLink } = require("../utils/wowhead");

// Bosses sort in the order the raid actually meets them (BOSS_ORDER in
// config/tbcContent.js), with the non-encounter buckets last: the timed chest,
// "Trash" and the nameless one ("" — an item no single kill can be pinned on).
// Whoever fills this in walked the instance an hour ago and reads the list that
// way, so alphabetical order — Gurtogg Bloodboil ahead of the Black Temple's
// first boss — is exactly wrong. Within one boss, the items sort by name.
function byBossThenName(contentId) {
    return (a, b) => bossOrder(contentId, a.boss) - bossOrder(contentId, b.boss)
        || a.boss.localeCompare(b.boss)
        || a.name.localeCompare(b.name);
}

/**
 * Every drop of one raid as the picker renders it. An id the name table doesn't
 * know keeps its id as the label rather than being dropped — it is still a
 * legitimate pick, it just looks unfinished until the names are regenerated.
 * @param {string} contentId
 * @returns {{id:number, name:string, iconUrl:string, itemLink:string, quality:number|null, boss:string}[]}
 */
function itemsForContent(contentId) {
    const byBoss = RAID_LOOT[String(contentId || "")] || null;
    if (!byBoss) return [];
    const items = [];
    for (const [boss, ids] of Object.entries(byBoss)) {
        for (const rawId of ids) {
            const id = Number(rawId);
            const meta = RAID_ITEMS[id] || null;
            items.push({
                id,
                name: meta ? meta[0] : `Item ${id}`,
                iconUrl: meta ? iconUrl(meta[1]) : "",
                itemLink: itemLink(id),
                quality: meta ? meta[2] : null,
                boss,
            });
        }
    }
    return items.sort(byBossThenName(contentId));
}

let cached = null;

/**
 * The full catalogue: every raid with its drops, in CONTENTS order.
 * @returns {{id:string, label:string, short:string, tier:string, tierLabel:string, items:object[]}[]}
 */
function lootCatalog() {
    if (!cached) {
        cached = CONTENTS.map((c) => {
            const t = tier(c.tier);
            return {
                id: c.id,
                label: c.label,
                short: c.short,
                tier: c.tier,
                tierLabel: t ? t.label : "",
                items: itemsForContent(c.id),
            };
        });
    }
    return cached;
}

/**
 * Which raids to preselect for an event: what its loot already says it was,
 * else what its title names. The already-imported loot wins — an item id is
 * evidence, a title is a plan ("SSC/TK" nights that never left SSC are the
 * normal case). Returns [] when neither says anything, and the picker then
 * offers every raid.
 * @param {{title?:string, items?:object[]}} param0
 * @returns {string[]} content ids, in CONTENTS order
 */
function suggestedContents({ title = "", items = [] } = {}) {
    const fromLoot = new Set((items || []).map((it) => it && it.contentId).filter(Boolean));
    if (fromLoot.size) return CONTENTS.map((c) => c.id).filter((id) => fromLoot.has(id));
    return contentsForText(title);
}

module.exports = { lootCatalog, itemsForContent, suggestedContents };
