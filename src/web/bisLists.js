// The BiS lists themselves: which gear set is best-in-slot for which caster
// DPS class and spec.
//
// The other two loot-council tabs ask about *raiders* — who is overdue, who
// would gain most. This one asks about the lists, and that is a comparison, so
// it comes out as a matrix rather than one list at a time: equipment slots are
// the rows, the WoWSims lists the columns. It reads in both directions — a
// column down is one complete set, a row across answers "who wants this piece"
// — and the fact that most caster drops are contested needs no explaining,
// because such an item simply stands in the same row more than once.
//
// The healers are on it too, and they are on it differently: WoWSims ships no
// healing set at all, so their lists come from Wowhead's written guides
// (config/bisSets). Those name items but no gems or enchants, which is why a
// column says where it came from — a sim result and a recommendation are not
// the same claim, and the page should not blur them.
//
// Two things the shape has to carry honestly, both of them consequences of
// WoWSims-TBC shipping five caster lists for nine specs:
//
//   - a spec without its own list borrows one (Fire and Frost play Arcane's,
//     Affliction and Demonology play Destruction's). The borrowers are named on
//     the column, so nobody reads a borrowed list as that spec's own.
//   - a list can be missing for a tier entirely — WoWSims has no Sunwell set
//     for Shadow or Arcane. That column is absent for the tier and said to be,
//     rather than quietly filled with the previous tier's set.
//
// Everything here is derived from config on read; nothing is stored.

const wowsims = require("../config/wowsims");
const bis = require("../config/bisSets");
const { SPECS } = require("../config/casterSpecs");
const { TIERS } = require("../config/tbcContent");
const { SLOT_NAMES } = require("../utils/logcheck/gearIssues");
const { characterProfile } = require("../utils/setupView");
const { itemView } = require("./lootCouncil");
const { DISPLAY_ORDER } = require("./charGear");

/** Every spec the tab can show a list for, in the order it lists them. */
function listedSpecs() {
    return SPECS.map((s) => {
        const look = characterProfile(s.className, s.spec) || {};
        const listKey = s.bisSpec || s.key;
        return {
            key: s.key,
            label: s.label,
            className: s.className,
            spec: s.spec,
            iconUrl: look.iconUrl || "",
            classColor: look.classColor || "",
            // Whose list this spec plays, and whether that is its own.
            role: s.role,
            listKey,
            ownList: listKey === s.key,
        };
    });
}

/**
 * A BiS set as slot -> item.
 *
 * The set is a flat list of item ids; which slot each one occupies is decided
 * the same way a character sheet decides it — first free slot the item fits.
 * That is what makes two rings or two trinkets land in slot one and two rather
 * than fighting over the same row.
 */
function bySlot(specKey, tierId) {
    const set = bis.bisFor(specKey, tierId);
    const used = new Set();
    const out = new Map();
    for (const entry of set.items) {
        if (!wowsims.item(entry.id)) continue;
        const slot = wowsims.slotsFor(entry.id).find((s) => !used.has(s));
        if (slot === undefined) continue;
        used.add(slot);
        out.set(slot, entry);
    }
    return out;
}

/**
 * Which lists exist for a tier, with everyone who plays them.
 *
 * A column is one list, not one spec: five columns carry nine specs, and the
 * borrowers ride on the column of the list they play.
 */
function columnsFor(tierId, specs) {
    const out = [];
    for (const key of bis.specsWithBis()) {
        if (!bis.bisTiers(key).includes(tierId)) continue;
        const owner = specs.find((s) => s.key === key);
        if (!owner) continue;
        out.push({
            key,
            label: owner.label,
            iconUrl: owner.iconUrl,
            classColor: owner.classColor,
            role: owner.role,
            // Where this list comes from. A Wowhead list is a written
            // recommendation without gems or enchants, and the column says so
            // rather than looking like a sim result.
            source: bis.sourceFor(key),
            sourceLabel: bis.SOURCE_LABEL[bis.sourceFor(key)] || "",
            users: specs.filter((s) => s.listKey === key).map((s) => ({
                key: s.key, label: s.label, ownList: s.ownList,
            })),
        });
    }
    return out;
}

/**
 * The whole tab's payload for one tier.
 *
 * @param {string} tierId "t4" | "t5" | "t6" | "t65"; anything unknown falls
 *        back to the newest tier every list has, so the page always has one.
 */
function bisLists(tierId = "") {
    const specs = listedSpecs();
    const known = TIERS.map((t) => t.id);
    const tier = known.includes(tierId) ? tierId : "t6";

    const columns = columnsFor(tier, specs);
    const sets = new Map(columns.map((c) => [c.key, bySlot(c.key, tier)]));

    // How many of *this tier's* lists want each item. The number a council
    // argues about, and the reason the matrix is worth reading across.
    //
    // Counted per list, not per position: a set that wants the same ring in
    // both finger slots still wants it on one list, and calling that "auf 2
    // Listen" would invent a second claimant. That the list wants two of them
    // is visible anyway — the item stands in both ring rows of its column.
    const shared = new Map();
    for (const set of sets.values()) {
        for (const id of new Set([...set.values()].map((e) => e.id))) {
            shared.set(id, (shared.get(id) || 0) + 1);
        }
    }

    const rows = [];
    for (const slot of DISPLAY_ORDER) {
        if (![...sets.values()].some((set) => set.has(slot))) continue;
        rows.push({
            slot,
            slotName: SLOT_NAMES[slot] || `Slot ${slot}`,
            cells: columns.map((col) => {
                const entry = sets.get(col.key).get(slot);
                if (!entry) return { column: col.key, item: null };
                return {
                    column: col.key,
                    item: itemView(entry.id, tier),
                    // How WoWSims socketed and enchanted it in the reference
                    // set — the one thing this view knows beyond "which item",
                    // and it exists nowhere else in the app.
                    gems: (entry.gems || []).filter(Boolean).length,
                    enchanted: !!entry.enchant,
                    shared: shared.get(entry.id) || 1,
                };
            }),
        });
    }

    return {
        tier,
        // Every tier with the lists it is missing, so a gap is stated rather
        // than silently backfilled from an older set.
        tiers: TIERS.map((t) => ({
            id: t.id,
            label: t.label,
            missing: specs
                .filter((s) => s.ownList && !bis.bisTiers(s.key).includes(t.id))
                .map((s) => s.label),
        })),
        specs,
        columns,
        rows,
        contested: [...shared.values()].filter((n) => n > 1).length,
    };
}

module.exports = { bisLists, listedSpecs, columnsFor, bySlot };
