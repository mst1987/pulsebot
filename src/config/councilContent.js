// Which parts of the loot council have content data for a game version (#748).
//
// The council's content - BiS lists, the item table (stats, slots, wear rules),
// the tier/raid filter, the loot table behind item weights and the simulation -
// exists for TBC only (WoWSims tbc-new, Wowhead BiS, generated TBC loot). For any
// other version these parts are switched off and the page says so; they are never
// filled with TBC data. What needs no content data stays: needs, wishes, received
// loot, the weighting by attendance and membership.
//
// One map, one function: a version that gets its own data later flips its flags
// here and nothing else has to learn about it.
const CONTENT = {
    tbc: { bis: true, sim: true, tiers: true, itemTable: true },
};

const NONE = Object.freeze({ bis: false, sim: false, tiers: false, itemTable: false });

/**
 * The council content a version has.
 * @param {string} versionId
 * @returns {{ bis: boolean, sim: boolean, tiers: boolean, itemTable: boolean }}
 */
function councilContentFor(versionId) {
    const id = String(versionId || "").trim();
    return CONTENT[id] ? { ...CONTENT[id] } : { ...NONE };
}

module.exports = { councilContentFor };
