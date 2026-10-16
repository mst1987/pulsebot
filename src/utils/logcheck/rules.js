// The log check's rule set per game version (#747) — what `rulesFor()`
// (config/gameVersions) is for the signup and the setup, this is for the
// analysis of a Warcraft-Logs report: which classes count as raiders, how a
// raider's RPB role is decided, which analyzers run, and the data tables those
// analyzers read (consumables, gems and enchants, raid buffs and debuffs,
// totems, healer auras, potions, drums, the RPB tables, zone tags, the
// excluded encounter, the haste formula, Bloodlust).
//
// TBC is today's modules wrapped unchanged: every table below is the very
// object the analyzers already read, so a TBC report is built byte for byte as
// before (test/utils/logcheck/report.golden.test.js).
//
// WoW Forever is prepared as a Classic-derived rule set with `ready: false`:
// only what is cheap and certainly right is filled in — the nine Classic
// classes with their specs, the role mapping, the analyzer list without the
// TBC-only analyzers, and the three facts Classic settles (no Kalecgos to
// exclude, no haste rating, no Bloodlust). Every other table is null and named
// in `missing`. Whether the log check may read a version at all is decided in
// services/logcheck/logVersion.js: rules ready AND a Warcraft-Logs site known
// (logcheckCapability).
//
// This module requires config (and logLinks, which requires nothing) only, never an analyzer (common.js and
// rpb/common.js require it): the tables the analyzers used to keep inside
// themselves (potions, drums, Bloodlust, the shadow resistance enchants, the
// RPB zone tags) now live in config/logcheckTables.js.
const gameVersions = require("../../config/gameVersions");
const tables = require("../../config/logcheckTables");
const claData = require("../../config/claData");
const rpbData = require("../../config/rpbData");
const raidBuffs = require("../../config/raidBuffs");
const raidDebuffs = require("../../config/raidDebuffs");
const totems = require("../../config/totems");
const healerSpells = require("../../config/healerSpells");
const { WCL_LEGACY_SITE } = require("./logLinks");

// The CLA analyzers in the order report.js runs them (its CLA_ANALYZERS carry
// the same keys — test/utils/logcheck/rules.test.js holds them together), and
// the RPB, which runs as one.
const CLA_ANALYZER_KEYS = [
    "consumables", "drums", "potions", "shadowResi", "sunder", "bossUptimes", "timeline", "fightSeries",
    "raidDebuffs", "cooldowns", "totems", "mechanics", "activity", "healers", "raidBuffs",
];
const RPB_ANALYZER = "rpb";
const ALL_ANALYZERS = [...CLA_ANALYZER_KEYS, RPB_ANALYZER];

// The analyzers WoW Forever leaves out, and why. Everything else would run
// once its data is there (see FOREVER_MISSING).
const FOREVER_LEFT_OUT = {
    drums: "Trommeln gibt es erst ab TBC.",
    totems: "Totem der beruhigenden Winde, Windzorn und Anmut der Luft stapeln in Forever nicht mehr: kein Totem-Twisting, die Auswertung misst genau das.",
    shadowResi: "Der Schattenwiderstand gilt Mutter Shahraz im Schwarzen Tempel (TBC).",
    rpb: "Die RPB-Tabellen sind TBC-Daten: Zauber-Ränge, Tempowertung, Kalecgos, Trash-Anforderungen der TBC-Raids.",
};

// What a Forever log check still needs before `ready` may become true.
const FOREVER_MISSING = [
    "Consumables mit Classic-IDs (Flasks, Elixiere, Essen, Waffenöl)",
    "Tränke und Runen der Classic-Zeit",
    "Verzauberungsregeln ohne Edelsteine (Classic kennt keine Sockel)",
    "Raid-Buffs mit Forever-Reichweite (viele Gruppen-Buffs wirken raidweit)",
    "Raid-Debuffs mit Classic-Rängen",
    "Heiler-Auren und Mana-Quellen der Classic-Zeit",
    "Klassen-Cooldowns, Schmuckstücke und Ingenieurskunst mit Classic-IDs",
    "Vermeidbarer Schaden je Forever-Boss",
];

const RPB_ROLE_OF_BUFF_ROLE = { tank: "Tank", healer: "Healer", caster: "Caster", melee: "Physical" };

/**
 * A raider's RPB role the way the RPB decides it for the nine pre-Wrath
 * classes: the majority of the roles WCL reported across the boss fights, with
 * the class's own tie-breaks (a Balance druid / Elemental shaman counts as
 * Caster, every other feral/enhancement as Physical). "" for a class it does
 * not know.
 *
 * @param {string} playerClass  WCL class name ("Druid", "Mage", ...)
 * @param {{dps:number, tank:number, healer:number, dpsSpec:string}} counts
 */
function classicRole(playerClass, counts) {
    const dps = counts.dps || 0;
    const tank = counts.tank || 0;
    const healer = counts.healer || 0;
    const spec = counts.dpsSpec || "";

    switch (playerClass) {
        case "Hunter":
        case "Rogue":
            return "Physical";
        case "Mage":
        case "Warlock":
            return "Caster";
        case "Priest":
            return dps >= tank && dps >= healer ? "Caster" : "Healer";
        case "Warrior":
            return dps >= tank && dps >= healer ? "Physical" : "Tank";
        case "Paladin":
            if (healer >= tank && healer >= dps) return "Healer";
            if (tank >= dps && tank >= healer) return "Tank";
            return "Physical";
        case "Druid":
            if (healer >= tank && healer >= dps) return "Healer";
            if (tank >= dps && tank >= healer) return "Tank";
            return spec === "Balance" ? "Caster" : "Physical";
        case "Shaman":
            if (healer >= tank && healer >= dps) return "Healer";
            if (tank >= dps && tank >= healer) return "Tank";
            return spec === "Elemental" ? "Caster" : "Physical";
        default:
            return "";
    }
}

/**
 * The role of a class the classic switch does not know, from the rule set's
 * specs: healer or tank by majority where the class has such a spec, else the
 * damage spec WCL named (its `buffRole`: caster → Caster, melee → Physical).
 */
function specRole(classDef, counts) {
    const dps = counts.dps || 0;
    const tank = counts.tank || 0;
    const healer = counts.healer || 0;
    const specs = classDef.specs || [];
    const canHeal = specs.some((s) => s.role === "healer");
    const canTank = specs.some((s) => s.role === "tank");
    if (canHeal && healer >= tank && healer >= dps) return "Healer";
    if (canTank && tank >= dps && tank >= healer) return "Tank";
    const damage = specs.filter((s) => s.role !== "tank" && s.role !== "healer");
    const named = damage.find((s) => s.id === counts.dpsSpec) || damage[0];
    if (named) return RPB_ROLE_OF_BUFF_ROLE[named.buffRole] || "Physical";
    if (canHeal) return "Healer";
    return canTank ? "Tank" : "Physical";
}

/**
 * A rule set from its parts. Exported so a test can build one with a class
 * outside the nine (the role and the player selection read only the rule set).
 *
 * @param {object} o
 * @param {string} o.versionId
 * @param {string} [o.label]
 * @param {Array<{id:string, specs:Array<{id,role,buffRole}>}>} o.classDefs  the rule set's classes (gameVersions shape)
 * @param {string[]} o.analyzers  keys of ALL_ANALYZERS that run, in any order
 * @param {boolean} [o.ready]
 * @param {object} [o.data]
 * @param {string[]} [o.missing]
 * @param {object} [o.leftOut]  analyzer key → why it does not run
 * @param {string} [o.apiSite]  the v1 site the log check asks, fixed by the rule set; "" = the
 *   Warcraft-Logs site of the version's settings (logVersion.wclApiSite)
 */
function makeRuleSet({ versionId, label = "", classDefs, analyzers, ready = false, data = {}, missing = [], leftOut = {}, apiSite = "" }) {
    const set = {
        versionId,
        label,
        ready: !!ready,
        apiSite,
        classes: classDefs.map((c) => c.id),
        classDefs,
        // kept in the order report.js runs them, whatever order was handed in
        analyzers: ALL_ANALYZERS.filter((k) => analyzers.includes(k)),
        data,
        missing,
        leftOut,
    };
    /** The RPB role of a raider of this rule set; an unknown class is Physical, as it always was. */
    set.roleForClass = (playerClass, counts) => {
        const c = counts || {};
        const def = classDefs.find((d) => d.id === playerClass);
        if (!def) return "Physical";
        return classicRole(playerClass, c) || specRole(def, c);
    };
    return Object.freeze(set);
}

function tbcData() {
    return Object.freeze({
        consumables: claData.CONSUMABLES,
        // gem quality, meta gems, sockets, enchantable slots, enchant blacklist
        gear: claData,
        raidBuffs,
        raidDebuffs,
        totems,
        healerSpells,
        rpb: rpbData,
        potions: tables.POTION_TYPES,
        drums: tables.DRUM_TYPE,
        bloodlust: Object.freeze({ ids: [...tables.LUST_IDS], durationMs: tables.LUST_MS }),
        shadowResistance: Object.freeze({ items: claData.SHADOW_RESISTANCE, enchants: tables.SR_ENCHANT, gems: tables.SR_GEM }),
        zoneTags: tables.ZONE_TAGS,
        excludedEncounterIds: [rpbData.EXCLUDED_ENCOUNTER_ID],
        hasteRatingPerPercent: rpbData.HASTE_RATING_PER_PERCENT,
    });
}

const TBC = makeRuleSet({
    versionId: "tbc",
    label: gameVersions.rulesFor("tbc").label,
    classDefs: gameVersions.rulesFor("tbc").classes,
    analyzers: ALL_ANALYZERS,
    ready: true,
    data: tbcData(),
    // TBC keeps the classic host the CLA port has always asked (it serves the fresh reports too, #746).
    apiSite: WCL_LEGACY_SITE,
});

const FOREVER = makeRuleSet({
    versionId: "forever",
    label: gameVersions.rulesFor("forever").label,
    // Classic's nine classes, specs and roles (confirmed by the user, #736)
    classDefs: gameVersions.rulesFor("forever").classes,
    analyzers: ALL_ANALYZERS.filter((k) => !Object.prototype.hasOwnProperty.call(FOREVER_LEFT_OUT, k)),
    ready: false,
    data: Object.freeze({
        consumables: null,
        gear: null,
        raidBuffs: null,
        raidDebuffs: null,
        totems: null,
        healerSpells: null,
        rpb: null,
        potions: null,
        drums: null,
        shadowResistance: null,
        zoneTags: null,
        // what Classic settles: no two-realm Kalecgos, no haste rating, no Bloodlust/Heroism
        excludedEncounterIds: [],
        hasteRatingPerPercent: null,
        bloodlust: null,
    }),
    missing: FOREVER_MISSING,
    leftOut: FOREVER_LEFT_OUT,
});

const RULE_SETS = { tbc: TBC, forever: FOREVER };

/**
 * The log check's rule set of a version, or null when it has none (Classic,
 * an unknown id). A stored record's version goes through logVersion's
 * recordVersion() first — one without a version is TBC.
 * @param {string} versionId
 */
function logcheckRules(versionId) {
    const id = String(versionId || "").trim();
    return Object.prototype.hasOwnProperty.call(RULE_SETS, id) ? RULE_SETS[id] : null;
}

/** The analyzers that run for a version, in run order; [] for a version without rules. */
function analyzersFor(versionId) {
    const rules = logcheckRules(versionId);
    return rules ? [...rules.analyzers] : [];
}

module.exports = {
    CLA_ANALYZER_KEYS, RPB_ANALYZER, ALL_ANALYZERS, FOREVER_LEFT_OUT, FOREVER_MISSING,
    logcheckRules, analyzersFor, makeRuleSet, classicRole, specRole,
};
