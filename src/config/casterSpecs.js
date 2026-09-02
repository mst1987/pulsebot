// Which specs the caster loot council covers, and what each of them values.
//
// The key is `"<Class>-<Spec>"` in Warcraft Logs' own spelling, because that is
// where class and spec come from (see web/characterInfo.js — the loot exports
// carry a class at best, never a spec). Everything else hangs off that key:
// the BiS list, the rotation to sim with, and the stat weights the fallback
// scoring uses when no sim result is available.

const { bisFor, aplFor } = require("./wowsims");

// Roles the page can filter by. "caster" is the DPS council's own scope;
// "healer" is there because the two argue over the same spell-power drops often
// enough that leaving them out would make the picture wrong, not smaller.
const ROLES = [
    { id: "caster", label: "Caster-DPS" },
    { id: "healer", label: "Heiler" },
];

/**
 * Stat weights, spell power = 1.0 — the classic TBC EP scale. They drive the
 * *fallback* upgrade score, the one used when the simulation cannot answer
 * (no binary, a healing spec, an unsupported build). A sim result always wins
 * over these; they are a reasonable ordering, not a claim of DPS.
 *
 * Hit is weighted at or above spell power for every DPS caster, which is the
 * whole point of the TBC hit cap: below it a miss costs the entire cast. Once a
 * raider is capped the number overstates hit — see lootCouncil.js, which stops
 * counting hit past the cap instead of pretending the weight itself changes.
 */
const CASTER_WEIGHTS = {
    spellPower: 1.0, spellHit: 1.0, spellCrit: 0.6, spellHaste: 0.55,
    intellect: 0.15, spirit: 0.1, mp5: 0.2, stamina: 0.02,
};
const HEALER_WEIGHTS = {
    healingPower: 1.0, spellPower: 1.0, mp5: 0.85, intellect: 0.35,
    spellCrit: 0.4, spellHaste: 0.45, spirit: 0.3, stamina: 0.05,
};

/**
 * Every spec the page knows.
 *
 * `bisSpec` is which spec's BiS list stands in when WoWSims ships none for this
 * one: a Fire Mage's gear priorities are close enough to Arcane's that the
 * Arcane list is a far better answer than an empty one, and the page marks such
 * a list as borrowed. `simSpec` works the same way for the rotation.
 *
 * `talents` is the WoWSims talent string the sim runs with — the reference
 * build for the spec, not the raider's own (a Warcraft-Logs report does not
 * carry a talent string). That is deliberate: the council compares *items*, and
 * holding the build fixed is what makes two raiders' numbers comparable.
 */
const SPECS = [
    {
        key: "Priest-Shadow", className: "Priest", spec: "Shadow", role: "caster",
        label: "Schattenpriester", wowClass: "ClassPriest", specField: "priest",
        talents: "500230013--503250510240103051451",
        // A shadow priest's shadow-school damage is its spell power.
        school: "shadowPower",
    },
    {
        key: "Mage-Arcane", className: "Mage", spec: "Arcane", role: "caster",
        label: "Arkan-Magier", wowClass: "ClassMage", specField: "mage",
        talents: "2500052300030150330125--053500031003001",
        school: "arcanePower",
    },
    // WoWSims-TBC sims one mage build (Arcane) and ships one mage BiS line, so
    // Fire and Frost borrow both. Their gear wants the same four stats in the
    // same order; only the school bonus differs, and that is carried per spec.
    {
        key: "Mage-Fire", className: "Mage", spec: "Fire", role: "caster",
        label: "Feuer-Magier", wowClass: "ClassMage", specField: "mage",
        talents: "2500052300030150330125--053500031003001",
        bisSpec: "Mage-Arcane", simSpec: "Mage-Arcane", school: "firePower",
    },
    {
        key: "Mage-Frost", className: "Mage", spec: "Frost", role: "caster",
        label: "Frost-Magier", wowClass: "ClassMage", specField: "mage",
        talents: "2500052300030150330125--053500031003001",
        bisSpec: "Mage-Arcane", simSpec: "Mage-Arcane", school: "frostPower",
    },
    {
        key: "Warlock-Destruction", className: "Warlock", spec: "Destruction", role: "caster",
        label: "Zerstörungs-Hexer", wowClass: "ClassWarlock", specField: "warlock",
        talents: "-20500301332101-50500051220051053105",
        school: "firePower",
    },
    {
        key: "Warlock-Affliction", className: "Warlock", spec: "Affliction", role: "caster",
        label: "Gebrechen-Hexer", wowClass: "ClassWarlock", specField: "warlock",
        talents: "05022221112351055003--50500051220001",
        bisSpec: "Warlock-Destruction", school: "shadowPower",
    },
    {
        key: "Warlock-Demonology", className: "Warlock", spec: "Demonology", role: "caster",
        label: "Dämonologie-Hexer", wowClass: "ClassWarlock", specField: "warlock",
        talents: "01-2050030133250101501351-5050005112",
        bisSpec: "Warlock-Destruction", school: "shadowPower",
    },
    {
        key: "Druid-Balance", className: "Druid", spec: "Balance", role: "caster",
        label: "Gleichgewichts-Druide", wowClass: "ClassDruid", specField: "balanceDruid",
        talents: "510022312503135231351--520033",
        school: "naturePower",
    },
    {
        key: "Shaman-Elemental", className: "Shaman", spec: "Elemental", role: "caster",
        label: "Elementar-Schamane", wowClass: "ClassShaman", specField: "elementalShaman",
        talents: "55003105100213351051--05105301005",
        school: "naturePower",
    },
    // ── Healers ───────────────────────────────────────────────────────────────
    // WoWSims-TBC has no healing sims and its healer gear sets are empty
    // placeholders (see scripts/fetch-wowsims-data.js), so these specs get the
    // loot history and the stat-weight scoring, and honestly report that there
    // is no BiS list and no simulation for them.
    {
        key: "Priest-Holy", className: "Priest", spec: "Holy", role: "healer",
        label: "Heilig-Priester", wowClass: "ClassPriest", specField: "priest",
    },
    {
        key: "Priest-Discipline", className: "Priest", spec: "Discipline", role: "healer",
        label: "Disziplin-Priester", wowClass: "ClassPriest", specField: "priest",
    },
    {
        key: "Druid-Restoration", className: "Druid", spec: "Restoration", role: "healer",
        label: "Wiederherstellungs-Druide", wowClass: "ClassDruid", specField: "restorationDruid",
    },
    {
        key: "Shaman-Restoration", className: "Shaman", spec: "Restoration", role: "healer",
        label: "Wiederherstellungs-Schamane", wowClass: "ClassShaman", specField: "restorationShaman",
    },
    {
        key: "Paladin-Holy", className: "Paladin", spec: "Holy", role: "healer",
        label: "Heilig-Paladin", wowClass: "ClassPaladin", specField: "holyPaladin",
    },
];

const BY_KEY = new Map(SPECS.map((s) => [s.key, s]));

// A class whose every spec is a caster: knowing the class alone is enough to
// place the raider, which matters because a loot export carries a class at
// best. The value is the spec to assume — for a mage that is only about which
// school bonus counts, for a warlock which rotation, and both are the common
// raid build.
const CASTER_ONLY_CLASSES = {
    Mage: "Mage-Arcane",
    Warlock: "Warlock-Destruction",
};

/**
 * The spec entry for a character, or null when they are not a caster/healer.
 *
 * Falls back to the class when the spec is unknown, but only where the class
 * settles it: a Priest without a spec could be shadow or holy, and guessing
 * would put them in the wrong council with a wrong BiS list. Such a character
 * is better shown as "Spec unbekannt" (which is what null leads to) than filed
 * confidently into the wrong row.
 */
function specFor(className, spec) {
    const cls = String(className || "").trim();
    const sp = String(spec || "").trim();
    if (!cls) return null;
    if (sp) {
        const exact = BY_KEY.get(`${cls}-${sp}`);
        if (exact) return exact;
    }
    const assumed = CASTER_ONLY_CLASSES[cls];
    return assumed ? { ...BY_KEY.get(assumed), assumedFromClass: true } : null;
}

/** The spec entry for a key, or null. */
function specByKey(key) {
    return BY_KEY.get(String(key || "")) || null;
}

/** Whether this class/spec belongs on the caster council at all. */
function isCasterSpec(className, spec) {
    return !!specFor(className, spec);
}

/** The stat weights a spec is judged by. */
function weightsFor(specEntry) {
    if (!specEntry) return CASTER_WEIGHTS;
    const base = specEntry.role === "healer" ? HEALER_WEIGHTS : CASTER_WEIGHTS;
    // A school bonus ("+30 shadow damage") is spell power that only counts for
    // this spec's school — worth exactly as much as spell power to them, and
    // nothing to anyone else, which is why it hangs on the spec and not on the
    // shared weight table.
    return specEntry.school ? { ...base, [specEntry.school]: base.spellPower } : base;
}

/**
 * The spell-hit rating a spec needs before further hit is worthless. 16% for a
 * level-73 boss, 12.6 rating per percent; the three talented specs get part of
 * it from talents and need correspondingly less gear hit.
 */
const HIT_CAP = 202;
const TALENTED_HIT = {
    "Priest-Shadow": 3 * 12.6,          // Shadow Focus
    "Warlock-Affliction": 3 * 12.6,      // Suppression
    "Warlock-Destruction": 0,
    "Warlock-Demonology": 0,
    "Mage-Arcane": 3 * 12.6,             // Elemental Precision
    "Mage-Fire": 3 * 12.6,
    "Mage-Frost": 3 * 12.6,
    "Druid-Balance": 3 * 12.6,           // Balance of Power
};

/** Gear spell-hit rating this spec still needs to be capped. 0 for healers. */
function hitCapFor(specEntry) {
    if (!specEntry || specEntry.role !== "caster") return 0;
    return Math.max(0, Math.round(HIT_CAP - (TALENTED_HIT[specEntry.key] || 0)));
}

/** The BiS list to show for this spec and tier, plus where it came from. */
function bisForSpec(specEntry, tierId) {
    if (!specEntry) return { items: [], tier: "", exact: false, borrowedFrom: "" };
    const own = bisFor(specEntry.key, tierId);
    if (own.items.length) return { ...own, borrowedFrom: "" };
    if (!specEntry.bisSpec) return { ...own, borrowedFrom: "" };
    const borrowed = bisFor(specEntry.bisSpec, tierId);
    return { ...borrowed, borrowedFrom: borrowed.items.length ? specEntry.bisSpec : "" };
}

/** The rotation to sim this spec with, or null when it has none. */
function aplForSpec(specEntry) {
    if (!specEntry) return null;
    return aplFor(specEntry.key) || (specEntry.simSpec ? aplFor(specEntry.simSpec) : null);
}

/** Whether the sim can produce a number for this spec at all. */
function isSimSupported(specEntry) {
    return !!(specEntry && specEntry.role === "caster" && specEntry.talents && aplForSpec(specEntry));
}

/**
 * Which specs have this item on their BiS list for a tier — the answer to "für
 * wen ist das eigentlich BiS?".
 *
 * Worth its own function because most caster drops are contested: 29 of the 50
 * items on a T6 caster BiS list are wanted by more than one spec, so "BiS" on
 * its own says nothing about *whose*.
 *
 * Specs that borrow another's list are folded into the spec they borrow from
 * (`alsoFor`) rather than listed separately. Otherwise every contested item
 * would show nine entries carrying five distinct claims, and the borrowed ones
 * are an assumption anyway — the page shows them as such.
 *
 * @returns [{ specKey, label, className, spec, role, alsoFor: [label] }]
 */
function bisSpecsForItem(itemId, tierId) {
    const id = Number(itemId);
    if (!id) return [];
    const owners = new Map();
    for (const spec of SPECS) {
        const bis = bisForSpec(spec, tierId);
        if (!bis.items.some((entry) => Number(entry.id) === id)) continue;
        // The spec whose list this actually is: the lender for a borrowed one.
        const ownerKey = bis.borrowedFrom || spec.key;
        if (!owners.has(ownerKey)) {
            const owner = BY_KEY.get(ownerKey) || spec;
            owners.set(ownerKey, {
                specKey: owner.key,
                label: owner.label,
                className: owner.className,
                spec: owner.spec,
                role: owner.role,
                tier: bis.tier,
                alsoFor: [],
            });
        }
        if (bis.borrowedFrom) owners.get(ownerKey).alsoFor.push(spec.label);
    }
    return [...owners.values()];
}

module.exports = {
    ROLES, SPECS, CASTER_WEIGHTS, HEALER_WEIGHTS, HIT_CAP,
    specFor, specByKey, isCasterSpec, weightsFor, hitCapFor, bisForSpec, aplForSpec, isSimSupported, bisSpecsForItem,
};
