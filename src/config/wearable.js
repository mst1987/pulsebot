// Who can put an item on at all.
//
// The loot council must never propose a raider for a piece they cannot equip:
// a warlock's tier helm to a mage, a mail chest to a priest, a two-handed axe
// to a rogue. The item table (config/wowsims, generated) carries everything
// the game checks — a class list on set and class-bound pieces, the armour
// type, the weapon type and hand, the ranged type — and this module holds the
// game's rules for reading them. Pure lookups, no I/O.
//
// Deliberately about *equipping*, not about *sense*: a shaman may well wear a
// cloth caster piece, and whether that is a good idea is what the simulation
// and the BiS lists are for. Only what the game itself refuses is refused here.
// And an item the table does not know passes — "cannot tell" is not "cannot
// wear", and dropping a raider on a guess would be the wrong kind of error.

const wowsims = require("./wowsims");

// Blizzard's class ids, as the item table's `classes` lists them (WoWSims'
// Class enum uses the same numbers).
const CLASS_IDS = {
    Warrior: 1, Paladin: 2, Hunter: 3, Rogue: 4, Priest: 5, Shaman: 7, Mage: 8, Warlock: 9, Druid: 11,
};
const CLASS_BY_ID = Object.fromEntries(Object.entries(CLASS_IDS).map(([name, id]) => [id, name]));
const CLASS_LABELS = {
    Warrior: "Krieger", Paladin: "Paladin", Hunter: "Jäger", Rogue: "Schurke", Priest: "Priester",
    Shaman: "Schamane", Mage: "Magier", Warlock: "Hexenmeister", Druid: "Druide",
};

// ArmorType (WoWSims proto/common.proto).
const ARMOR_LABELS = { 1: "Stoff", 2: "Leder", 3: "Kette", 4: "Platte" };
// The slots the armour proficiency applies to (WCL numbers): head, shoulder,
// chest, wrist, hands, waist, legs, feet. Not the back — a cloak is "cloth" in
// the table, and every class wears one.
const ARMOR_SLOTS = new Set([0, 2, 4, 8, 9, 5, 6, 7]);
const ARMOR_BY_CLASS = {
    Warrior: [1, 2, 3, 4], Paladin: [1, 2, 3, 4],
    Hunter: [1, 2, 3], Shaman: [1, 2, 3],
    Rogue: [1, 2], Druid: [1, 2],
    Priest: [1], Mage: [1], Warlock: [1],
};

// WeaponType: 1 Axe, 2 Dagger, 3 Fist, 4 Mace, 5 Off-hand, 6 Polearm,
// 7 Shield, 8 Staff, 9 Sword. Two lists per class, because the hand matters:
// a rogue swings one-handed axes and never a two-handed one.
const WEAPON_LABELS = {
    1: "Axt", 2: "Dolch", 3: "Faustwaffe", 4: "Streitkolben", 5: "Nebenhand",
    6: "Stangenwaffe", 7: "Schild", 8: "Stab", 9: "Schwert",
};
const ONE_HAND_BY_CLASS = {
    Warrior: [1, 2, 3, 4, 5, 7, 9],
    Paladin: [1, 4, 5, 7, 9],
    Hunter: [1, 2, 3, 5, 9],
    Rogue: [1, 2, 3, 4, 5, 9],
    Priest: [2, 4, 5],
    Shaman: [1, 2, 3, 4, 5, 7],
    Mage: [2, 5, 9],
    Warlock: [2, 5, 9],
    Druid: [2, 3, 4, 5],
};
const TWO_HAND_BY_CLASS = {
    Warrior: [1, 4, 6, 8, 9],
    Paladin: [1, 4, 6, 9],
    Hunter: [1, 6, 8, 9],
    Rogue: [],
    Priest: [8],
    // Two-handed axes and maces need the enhancement talent — see wearCheck.
    Shaman: [8],
    Mage: [8],
    Warlock: [8],
    Druid: [4, 8],
};

// RangedWeaponType: 1 Bow, 2 Crossbow, 3 Gun, 4 Thrown, 5 Wand, 6 Idol,
// 7 Libram, 8 Totem. The relics are the strictest rule in the game: one class
// each.
const RANGED_LABELS = {
    1: "Bogen", 2: "Armbrust", 3: "Schusswaffe", 4: "Wurfwaffe", 5: "Zauberstab",
    6: "Götze", 7: "Buchband", 8: "Totem",
};
const RANGED_BY_CLASS = {
    Warrior: [1, 2, 3, 4], Hunter: [1, 2, 3, 4], Rogue: [1, 2, 3, 4],
    Priest: [5], Mage: [5], Warlock: [5],
    Druid: [6], Paladin: [7], Shaman: [8],
};

const OK = Object.freeze({ ok: true, reason: "", note: "" });

/** "Krieger, Paladin" for a list of class ids. */
function classNames(ids) {
    return ids.map((id) => CLASS_LABELS[CLASS_BY_ID[id]] || "").filter(Boolean);
}

/**
 * Whether a class can equip an item, and if not, why.
 *
 * @param {string} className  WCL's spelling ("Priest", "Mage", …)
 * @param {number|string} itemId
 * @param {{spec?: string}} [opts] the spec, for the one rule that depends on
 *        it (a shaman's two-handed axes and maces come with the enhancement
 *        talent)
 * @returns {{ok: boolean, reason: ""|"class"|"armor"|"weapon"|"ranged", note: string}}
 *          `note` is the short German reason the page shows next to the name
 */
function wearCheck(className, itemId, { spec = "" } = {}) {
    const cls = String(className || "").trim();
    const item = wowsims.item(itemId);
    // Nothing to check against: an unknown item, or a class the rules do not
    // know. Passing is the honest answer — see the file header.
    if (!item || !CLASS_IDS[cls]) return OK;

    if (Array.isArray(item.classes) && item.classes.length && !item.classes.includes(CLASS_IDS[cls])) {
        return { ok: false, reason: "class", note: `nur für ${classNames(item.classes).join(", ") || "andere Klassen"}` };
    }

    if (item.armorType && (item.slots || []).some((slot) => ARMOR_SLOTS.has(slot))
        && !ARMOR_BY_CLASS[cls].includes(item.armorType)) {
        const wears = ARMOR_BY_CLASS[cls].map((t) => ARMOR_LABELS[t]).join("/");
        return { ok: false, reason: "armor", note: `${ARMOR_LABELS[item.armorType]} — ${CLASS_LABELS[cls]} trägt nur ${wears}` };
    }

    if (item.weaponType) {
        const two = item.hand === "two";
        let allowed = (two ? TWO_HAND_BY_CLASS[cls] : ONE_HAND_BY_CLASS[cls]).includes(item.weaponType);
        if (!allowed && cls === "Shaman" && two && [1, 4].includes(item.weaponType) && /enhancement|verst/i.test(String(spec))) {
            allowed = true;
        }
        if (!allowed) {
            const label = `${two ? "Zweihand-" : ""}${WEAPON_LABELS[item.weaponType] || "Waffe"}`;
            const hint = cls === "Shaman" && two && [1, 4].includes(item.weaponType) ? " ohne Verstärker-Talent" : "";
            return { ok: false, reason: "weapon", note: `${label} — kann ${CLASS_LABELS[cls]}${hint} nicht führen` };
        }
    }

    if (item.rangedType && !RANGED_BY_CLASS[cls].includes(item.rangedType)) {
        return { ok: false, reason: "ranged", note: `${RANGED_LABELS[item.rangedType] || "Distanzwaffe"} — kann ${CLASS_LABELS[cls]} nicht anlegen` };
    }
    return OK;
}

/** The yes/no half of wearCheck. */
function canWear(className, itemId, opts) {
    return wearCheck(className, itemId, opts).ok;
}

module.exports = {
    wearCheck, canWear, CLASS_IDS, CLASS_LABELS, ARMOR_LABELS, WEAPON_LABELS, RANGED_LABELS, ARMOR_BY_CLASS,
};
