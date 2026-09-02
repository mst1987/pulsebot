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

const { slotsFor, item: itemInfo } = require("../../config/wowsims");
const { metaGemActive } = require("../logcheck/gearIssues");
const claData = require("../../config/claData");

const META_GEMS = new Set(claData.META_GEM_IDS.map(String));
const RED_GEMS = new Set(claData.RED_GEM_IDS.map(String));
const YELLOW_GEMS = new Set(claData.YELLOW_GEM_IDS.map(String));
const BLUE_GEMS = new Set(claData.BLUE_GEM_IDS.map(String));

/**
 * Drop a meta gem whose colour requirement the raider does not meet.
 *
 * ⚠️ Measured against the pinned binary: WoWSims does NOT check the condition —
 * a Chaotic Skyfire Diamond without its two blue gems still contributes its
 * stats and its crit bonus (1809 vs 1806 DPS in a run where it should have been
 * inactive). So a raider who socketed wrongly would be simulated as if they had
 * not, and the council would compare them against raiders who did it right.
 *
 * The same rule the gear check already applies (`metaGemActive`), so the sim and
 * the "Meta-Gem inaktiv" finding in a CLA report can never disagree.
 *
 * @returns {{items: Array, dropped: string[]}} the gear with inactive metas
 *          removed, and which ones went
 */
function stripInactiveMeta(items) {
    let red = 0;
    let yellow = 0;
    let blue = 0;
    let meta = 0;
    for (const it of items) {
        for (const gem of it.gems || []) {
            const id = String(gem);
            if (!gem) continue;
            // A dual-colour gem counts for both of its colours, same as the
            // gear check counts them.
            if (META_GEMS.has(id)) meta = Number(gem);
            if (RED_GEMS.has(id)) red += 1;
            if (YELLOW_GEMS.has(id)) yellow += 1;
            if (BLUE_GEMS.has(id)) blue += 1;
        }
    }
    if (!meta || metaGemActive(meta, red, yellow, blue)) return { items, dropped: [] };
    return {
        items: items.map((it) => ({
            ...it,
            gems: (it.gems || []).map((gem) => (Number(gem) === meta ? 0 : gem)),
        })),
        dropped: [String(meta)],
    };
}

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
 * @param {object} [swap]    one item to put in before building:
 *                           { slot, itemId, enchantId?, gems?, clears?: number[] }
 *                           `clears` empties further slots the item takes over —
 *                           a two-handed weapon also costs the off hand, and
 *                           leaving that equipped next to the staff would give
 *                           the raider DPS from gear they cannot wear.
 * @returns {{items: Array, warnings: string[]}}
 */
function equipmentFor(gear, swap = null) {
    const warnings = [];
    const bySlot = new Map();
    for (const it of (gear && gear.items) || []) {
        if (Number(it.itemId) > 0) bySlot.set(Number(it.slot), it);
    }
    if (swap && Number(swap.itemId) > 0) {
        for (const slot of swap.clears || []) bySlot.delete(Number(slot));
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

    // An inactive meta gem has to go before the request is built — the binary
    // would count it regardless (see stripInactiveMeta).
    const meta = stripInactiveMeta([...bySlot.values()]);
    if (meta.dropped.length) {
        for (const it of meta.items) bySlot.set(Number(it.slot), it);
        warnings.push("Meta-Edelstein inaktiv (Farbbedingung nicht erfüllt) — für die Simulation ausgelassen.");
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

// The two hands, in the order a character sheet shows them.
const MAIN_HAND = 15;
const OFF_HAND = 16;

/**
 * Where a drop would go for this raider, what it would displace, and which
 * slots were in play at all.
 *
 * Three cases, and each used to be answered wrongly by "pick one slot":
 *
 *   - A **doubled slot** (rings, trinkets) has two candidates and only one is
 *     replaced — the weaker of the two, because that is the one an upgrade
 *     actually pushes out. A council still wants to see both: which ring is
 *     kept is half the decision. `options` carries both, `replaces` the one
 *     that goes.
 *   - A **two-handed weapon** takes main hand *and* off hand, so accepting one
 *     costs the raider both pieces. `displaces` lists them; without that the
 *     simulation would keep the off hand equipped next to the staff and report
 *     DPS the raider will never have.
 *   - A **one-hander** may go in either hand, and an empty hand always wins
 *     over a filled one.
 *
 * @returns {{slot, replaces, displaces: object[], clears: number[], options: object[]}|null}
 *          null when the item fits no slot this raider has
 */
function targetSlotFor(gear, itemId) {
    const slots = slotsFor(itemId);
    if (!slots.length) return null;
    const item = itemInfo(itemId);
    const worn = new Map(((gear && gear.items) || []).map((it) => [Number(it.slot), it]));

    // A two-hander is not a choice between two slots — it occupies both.
    if (item && item.hand === "two") {
        const displaces = [worn.get(MAIN_HAND), worn.get(OFF_HAND)].filter(Boolean);
        return {
            slot: MAIN_HAND,
            // The main-hand piece is what it "replaces" for scoring; the off
            // hand is lost on top and shows up in `displaces`.
            replaces: worn.get(MAIN_HAND) || null,
            displaces,
            // Told to the simulation so the off hand is emptied with the swap.
            clears: [OFF_HAND],
            options: [MAIN_HAND, OFF_HAND].map((slot) => ({
                slot, item: worn.get(slot) || null, chosen: true,
            })),
        };
    }

    // Everything else: the emptiest, then the weakest of the candidate slots.
    let pick = null;
    for (const slot of slots) {
        const current = worn.get(slot) || null;
        const level = current ? (Number(current.itemLevel) || 0) : -1;
        if (!pick || level < pick.level) pick = { slot, replaces: current, level };
    }
    if (!pick) return null;
    return {
        slot: pick.slot,
        replaces: pick.replaces,
        displaces: pick.replaces ? [pick.replaces] : [],
        clears: [],
        // Every slot the item could have gone in, so a doubled slot shows both
        // pieces with the one that would go marked.
        options: slots.map((slot) => ({
            slot, item: worn.get(slot) || null, chosen: slot === pick.slot,
        })),
    };
}

module.exports = { equipmentFor, playerFor, targetSlotFor, SLOT_ORDER, RACE_BY_CLASS };
