// What a raider wore on the *other* bosses of the same night.
//
// The report is built from one casts table spanning the whole raid, and WCL
// answers it with a single gear snapshot per player. For judging gems and
// enchants that is exactly right. For a piece somebody swaps in for one boss it
// is not: Mark of the Champion goes on for Illidan and comes off again (see
// config/situationalItems.js), and the snapshot may well be the fight it was on.
//
// Judging a caster on that trinket is the same mistake as judging them on
// healing gear — the slot reads as empty in every comparison, so any trinket
// that drops looks like a bigger upgrade for them than for anyone in normal
// gear. The loot council used to fix this by reaching back into *older*
// evaluations. Closer to the truth is the same night: walk the fights until one
// shows something else in that slot, and that is what the raider actually plays
// with.
//
// Deliberately narrow, because every fight costs an API call:
//   - it only runs when a situational piece is really equipped, which for most
//     raids means it does not run at all,
//   - it stops as soon as every open slot has an answer,
//   - it is bounded by MAX_FIGHTS,
//   - and any failure leaves the report exactly as it was. A missing
//     alternative is a small loss; a report that fails to build is a big one.

const { selectPlayers } = require("./common");
const { buildArmory } = require("./gearIssues");
const { situationalItem } = require("../../config/situationalItems");

// How many fights of a night are looked at before giving up. A TBC raid night
// is 8-12 boss fights; past that the snapshot is old enough that the older
// evaluations (see web/charGear.js) are the better source anyway.
const MAX_FIGHTS = 12;

/** The armory rows of a roster entry that hold a boss-specific piece. */
function situationalSlots(entry) {
    return (entry.armory || []).filter((it) => it && situationalItem(it.itemId));
}

/**
 * Fill in `alternate` on every armory row holding a boss-specific piece.
 *
 * @param {object} wcl      the Warcraft-Logs client
 * @param {string} reportId
 * @param {object} fights   the report's fight list (report/fights response)
 * @param {object[]} roster the roster rows, modified in place
 * @returns {Promise<{checked: number, resolved: number}>}
 */
async function resolveSituationalGear(wcl, reportId, fights, roster) {
    // Who is missing what. Built once: if nobody wears such a piece — the
    // normal case — this returns without touching the network at all.
    const open = new Map();
    for (const entry of roster) {
        const slots = situationalSlots(entry);
        if (slots.length) open.set(entry.name, { entry, want: new Map(slots.map((it) => [Number(it.slot), it])) });
    }
    if (!open.size) return { checked: 0, resolved: 0 };

    const bossFights = ((fights && fights.fights) || []).filter((f) => f.boss && f.boss > 0);
    let checked = 0;
    let resolved = 0;

    for (const fight of bossFights.slice(0, MAX_FIGHTS)) {
        if (!open.size) break;
        let table;
        try {
            table = await wcl.getCasts(reportId, fight.start_time, fight.end_time);
        } catch {
            // One unreadable fight is not worth abandoning the rest.
            continue;
        }
        checked += 1;

        for (const player of selectPlayers(table)) {
            const pending = open.get(player.name);
            if (!pending || !pending.want.size) continue;
            const { entry, want } = pending;
            // The same builder the report itself uses, so an alternative
            // carries its gems and enchant status like any other piece.
            const armory = buildArmory(player, { gemsToConsider: 3 });
            for (const [slot, worn] of [...want]) {
                const found = armory.find((it) => Number(it.slot) === slot);
                if (!found || String(found.itemId) === String(worn.itemId)) continue;
                if (situationalItem(found.itemId)) continue;
                // Never something the raider wears elsewhere in this set (or is
                // already standing in for another slot): two of the same trinket
                // is not gear anyone can equip, and its stats would count twice.
                const clash = (entry.armory || []).some((it) => (
                    Number(it.slot) !== slot
                    && (String(it.itemId) === String(found.itemId)
                        || (it.alternate && String(it.alternate.itemId) === String(found.itemId)))
                ));
                if (clash) continue;
                worn.alternate = { ...found, fight: fight.name || "" };
                want.delete(slot);
                resolved += 1;
            }
            if (!want.size) open.delete(player.name);
        }
    }
    return { checked, resolved };
}

module.exports = { resolveSituationalGear, situationalSlots, MAX_FIGHTS };
