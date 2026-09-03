// Items whose worth depends on what the raid happens to be fighting, and which
// therefore must not be compared against like ordinary gear.
//
// "Mark of the Champion" is the case this list exists for. It carries no stats
// at all — its whole value is "+85 Schaden gegen Untote und Dämonen". Against
// Illidan or Archimonde that is a real trinket; everywhere else it is an empty
// slot, and WoWSims models it as exactly that. Measured against the pinned
// binary on a T6 shadow-priest reference set:
//
//     BiS-Trinket           1813 DPS
//     Mark of the Champion  1758 DPS
//     Slot leer             1758 DPS   ← identisch
//
// Leaving such a piece in the comparison distorts the very question a council
// asks. The raider wearing it looks like they have *nothing* in that slot, so a
// dropping trinket is credited to them at its full value (+55 DPS here) while
// everyone with a proper trinket is only credited the difference. The player
// with the situational trinket is ranked as the neediest — because of an item
// they deliberately equipped for one boss.
//
// So the loot council substitutes: it looks back through the older evaluations
// for what that raider wears in the slot the rest of the time (charGear.js's
// fillSituational). Only if no raid ever showed anything else there does the
// piece stay, marked — an unexplained gap is worse than a flagged one.
//
// ⚠️ This is a hand-kept list on purpose. The generated WoWSims item table
// carries no field for "only against creature type X" (verified: a trinket
// entry has name, icon, slots, ilvl, quality, phase, stats and nothing else),
// so there is nothing to derive it from. Add an id here when a raider turns up
// wearing another one; `note` is shown to the council, so say *why* it does not
// count, not just that it does not.

/** id -> { name, note } */
const SITUATIONAL_ITEMS = {
    // Kel'Thuzad's quest reward, both halves: 23206 gives melee attack power,
    // 23207 spell damage. Both only against Undead and Demons.
    23206: {
        name: "Mark of the Champion",
        note: "wirkt nur gegen Untote und Dämonen — im Vergleich so viel wert wie ein leerer Slot",
    },
    23207: {
        name: "Mark of the Champion",
        note: "wirkt nur gegen Untote und Dämonen — im Vergleich so viel wert wie ein leerer Slot",
    },
};

/**
 * The entry for an item, or null when it is ordinary gear.
 * @param {number|string} itemId
 * @returns {{name: string, note: string}|null}
 */
function situationalItem(itemId) {
    return SITUATIONAL_ITEMS[Number(itemId)] || null;
}

/** Whether this item's worth depends on the boss. */
function isSituational(itemId) {
    return !!situationalItem(itemId);
}

module.exports = { SITUATIONAL_ITEMS, situationalItem, isSituational };
