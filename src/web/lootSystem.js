// Which loot system a raid runs on — Softres, Loot-Council, GDKP or something
// else — and what the menu should therefore offer for it.
//
// The question it answers is "does a softres list belong to this raid?". A
// Loot-Council raid has no use for one, and nudging the orga to create it on
// every Loot-Council night ("Softres fehlt") is noise. So:
//
//   * the **category** sets the default (`config.categoryLootSystem`, edited
//     in Einstellungen → Kategorien). A category nobody picked one for follows
//     its loot addon: RCLootcouncil means Loot-Council, anything else Softres —
//     that was the behaviour before the setting existed;
//   * one **raid** can override it (`eventLootSystemStore`), and switch the
//     softres list on in addition ("Softres zusätzlich", e.g. a Loot-Council
//     raid that soft-reserves the BoEs);
//   * a raid that already **has** a softres list always shows it — the link
//     must never vanish just because the system was changed afterwards.
//
// Pure: the config and the override come in as arguments, so every rule is a
// plain Jest test.

const LOOT_SYSTEMS = ["softres", "lootcouncil", "gdkp", "other"];

const LOOT_SYSTEM_LABELS = {
    softres: "Softres",
    lootcouncil: "Loot-Council",
    gdkp: "GDKP",
    other: "Anderes",
};

/** A known system key, or "" for anything else. */
function normalizeLootSystem(value) {
    const v = String(value || "").trim();
    return LOOT_SYSTEMS.includes(v) ? v : "";
}

/**
 * Normalise categoryLootSystem to `{ [categoryId]: system }`. An empty or
 * unknown value drops the category, so it follows its loot addon again.
 */
function normalizeCategoryLootSystem(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, system] of Object.entries(raw)) {
        const key = String(catId).trim();
        const value = normalizeLootSystem(system);
        if (key && value) out[key] = value;
    }
    return out;
}

/**
 * The system a category's raids run on, and where that came from:
 * "category" (set in Einstellungen), "addon" (derived from RCLootcouncil) or
 * "default" (Softres).
 */
function categoryLootSystem(config, categoryId) {
    const id = String(categoryId || "");
    const set = normalizeLootSystem(((config && config.categoryLootSystem) || {})[id]);
    if (set) return { system: set, source: "category" };
    if (((config && config.categoryLootTool) || {})[id] === "rclc") return { system: "lootcouncil", source: "addon" };
    return { system: "softres", source: "default" };
}

/**
 * Everything a reader needs about one raid's loot system.
 * @param {{ config?: object, categoryId?: string, override?: { system?: string, softres?: boolean }|null, softresList?: object|null }} input
 * @returns {{ system: string, label: string, source: string, categorySystem: string, categoryLabel: string,
 *             softresExtra: boolean, softres: boolean }}
 *   `softres` = the raid gets the softres step, badge and menu entry.
 */
function resolveLootSystem({ config = {}, categoryId = "", override = null, softresList = null } = {}) {
    const cat = categoryLootSystem(config, categoryId);
    const own = normalizeLootSystem(override && override.system);
    const system = own || cat.system;
    const softresExtra = !!(override && override.softres === true) && system !== "softres";
    const hasList = !!(softresList && softresList.url);
    return {
        system,
        label: LOOT_SYSTEM_LABELS[system],
        source: own ? "event" : cat.source,
        categorySystem: cat.system,
        categoryLabel: LOOT_SYSTEM_LABELS[cat.system],
        softresExtra,
        softres: system === "softres" || softresExtra || hasList,
    };
}

module.exports = {
    LOOT_SYSTEMS, LOOT_SYSTEM_LABELS,
    normalizeLootSystem, normalizeCategoryLootSystem, categoryLootSystem, resolveLootSystem,
};
