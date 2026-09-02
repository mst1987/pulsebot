// Turns a raider's last-seen gear (web/charGear.js, read out of a CLA report's
// armory) into the equipment block of a WoWSims request.
//
// The translation is nearly free, because Warcraft Logs already hands back
// exactly what WoWSims wants: `itemId` is the Wowhead item id, `enchantId` is
// the permanent-enchant *effect* id — which is the id WoWSims' import matches
// first — and gems are Wowhead gem ids in socket order.
//
// Two things it does NOT do, both on purpose:
//   - it does not guess a race. Race matters for a couple of percent of a
//     caster's DPS and a Warcraft-Logs casts table does not carry it, so every
//     raider is built with the same one (see RACE_BY_CLASS). The council
//     compares raiders against each other and each raider against themselves
//     with one more item, and a constant cancels out of both.
//   - it does not take the raider's talents. See casterSpecs.js — the reference
//     build is what makes two raiders comparable.

const { slotsFor } = require("../../config/wowsims");

// WoWSims orders ambiguous slots positionally (ring 1/2, trinket 1/2, main/off
// hand), so items go out in this fixed order — the same order WoWSims' own
// equipment array uses. Note there is no shirt/tabard: WCL slot 3 is the shirt
// and never carries stats.
const SLOT_ORDER = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];

// One race per class, held constant for every raider of that class (see the
// note above). These are the races WoWSims' own presets use for their reference
// caster, so a number produced here lines up with a number produced there.
const RACE_BY_CLASS = {
    Priest: "RaceUndead",
    Mage: "RaceBloodElf",
    Warlock: "RaceOrc",
    Druid: "RaceNightElf",
    Shaman: "RaceDraenei",
    Paladin: "RaceBloodElf",
};

/**
 * The equipment array for a gear snapshot, in WoWSims' slot order.
 *
 * @param {object} gear      a charGear.js snapshot ({ items: [{slot, itemId, gems, enchantId}] })
 * @param {object} [swap]    one item to put in before building: { slot, itemId, enchantId?, gems? }
 * @returns {{items: Array, warnings: string[]}}
 */
function equipmentFor(gear, swap = null) {
    const warnings = [];
    const bySlot = new Map();
    for (const it of (gear && gear.items) || []) {
        if (Number(it.itemId) > 0) bySlot.set(Number(it.slot), it);
    }
    if (swap && Number(swap.itemId) > 0) {
        // A swapped-in item keeps the enchant and gems of the piece it replaces
        // where the caller did not state its own: the raider would enchant and
        // socket a new item too, and comparing a fresh drop's bare stats against
        // a fully enchanted one would understate every upgrade.
        const replaced = bySlot.get(Number(swap.slot));
        bySlot.set(Number(swap.slot), {
            slot: Number(swap.slot),
            itemId: Number(swap.itemId),
            enchantId: swap.enchantId !== undefined ? Number(swap.enchantId) : Number((replaced && replaced.enchantId) || 0),
            gems: Array.isArray(swap.gems) ? swap.gems : ((replaced && replaced.gems) || []),
        });
    }

    const items = [];
    for (const slot of SLOT_ORDER) {
        const it = bySlot.get(slot);
        if (!it) continue;
        const spec = { id: Number(it.itemId) };
        const enchant = Number(it.enchantId || 0);
        if (enchant > 0) spec.enchant = enchant;
        // Gems are positional; 0 is an empty socket and trailing empties are
        // dropped, exactly as WoWSims' own export writes them.
        const gems = (it.gems || []).map((g) => Number(g) || 0);
        while (gems.length && gems[gems.length - 1] === 0) gems.pop();
        if (gems.length) spec.gems = gems;
        items.push(spec);
    }
    if (!items.length) warnings.push("Kein Gear bekannt — die Simulation hat nichts zu rechnen.");
    return { items, warnings };
}

/**
 * The full player block of a sim request.
 *
 * @param {object} args { gear, specEntry, preset, apl, swap }
 */
function playerFor({ gear, specEntry, preset, apl, swap = null }) {
    const { items, warnings } = equipmentFor(gear, swap);
    return {
        player: {
            name: (gear && gear.character) || "Raider",
            race: RACE_BY_CLASS[specEntry.className] || "RaceBloodElf",
            class: specEntry.wowClass,
            equipment: { items },
            talentsString: specEntry.talents,
            [specEntry.specField]: { options: preset.options },
            rotation: apl,
            consumables: preset.consumables,
            buffs: preset.buffs.individual,
            ...preset.player,
        },
        warnings,
    };
}

/**
 * Which equip slot a drop would go into for this raider, and what it would
 * replace. For a doubled slot (rings, trinkets) that is the *weaker* of the two
 * they wear, because that is the one an upgrade actually pushes out; an empty
 * slot always wins over a filled one.
 *
 * @returns {{slot: number, replaces: object|null}|null} null when the item fits no slot
 */
function targetSlotFor(gear, itemId) {
    const slots = slotsFor(itemId);
    if (!slots.length) return null;
    const worn = new Map(((gear && gear.items) || []).map((it) => [Number(it.slot), it]));
    let best = null;
    for (const slot of slots) {
        const current = worn.get(slot) || null;
        if (!current) return { slot, replaces: null }; // an empty slot is the obvious home
        const level = Number(current.itemLevel) || 0;
        if (!best || level < best.level) best = { slot, replaces: current, level };
    }
    return best ? { slot: best.slot, replaces: best.replaces } : null;
}

module.exports = { equipmentFor, playerFor, targetSlotFor, SLOT_ORDER, RACE_BY_CLASS };
