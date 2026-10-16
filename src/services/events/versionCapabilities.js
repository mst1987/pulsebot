// What a game version can do and what it does (#761) — the one source every
// per-version check asks. Each feature of config/versionFeatures.js is, per
// version:
//
//   possible  the data, rules or settings for it exist: in the code's data (the
//             rule set of config/gameVersions, the log check's rule set in
//             utils/logcheck/rules.js), in the version's settings (Einstellungen →
//             Spielversion) or in a store (the raid plan catalog). Never a list of
//             version ids here — a new version brings its data, not code.
//   enabled   the setting `versionSettings[<id>].disabled` does not name it —
//             on by default for every feature, so nothing needs a migration.
//   on        possible AND enabled. A feature switched off behaves like one
//             that is not possible, only its hint says "ausgeschaltet".
//
// Why a feature is not possible:
//   logcheck         the log rule set is missing or not ready, or no Warcraft-Logs site (logcheckCapability)
//   lootCouncilBis   never for a known version: with the rule set's `councilContent.bis` (BiS lists,
//                    item table, tier filter), else with the orga's hand lists (#760, manualBisStore)
//   simulation       the rule set has no `councilContent.sim` (WoWSims)
//   raidSheet        the rule set has no `sheetLayout` (the Google raid sheet is TBC's)
//   softres          no softres edition in the version's settings
//   armory           region, realm or namespace missing in the version's settings
//   wowheadLinks     no Wowhead path in the version's settings
//   raidplanCatalog  no mob or spell of the catalog belongs to the version
//   dungeonTimes     the rule set has no `dungeonTimes` (no LevelHelper addon for its client)
//
// The readers: the log check (logVersion.logcheckSupported and its refusal), the
// loot council (councilContent: route, view, /council), the raid sheet
// (sheetOffered / sheetVersionRefusal: the raid detail's planning, POST
// /api/raids/fill, /fillsetup), softres (the raid detail, POST /api/raids/softres),
// the armory (versionSettings.blizzardFor), the Wowhead links (versionSettings.
// versionLinks, the guild bank's links), the raid plan catalog (catalogEnabled:
// the plan's catalog and the assignment suggestions) and the dungeon times of the
// profile (services/characters/profileRaiding.js). Einstellungen → Spielversion
// shows the matrix (capabilityMatrix, GET /api/settings).
//
// Deliberately low in the require graph (test/web/noCycles.test.js): data, the
// settings schema, the log rule sets, the catalog store and the config store —
// never one of its readers. So the settings block is read here from the config
// directly (the same normaliser settingsForVersion uses), not through versionSettings.js.
const { VERSION_FEATURES, isVersionFeature } = require("../../config/versionFeatures");
const { VERSIONS, rulesFor, hasSheetLayout } = require("../../config/gameVersions");
const { normalizeBlock, versionSettingsOf, wclSiteOf } = require("../../stores/versionSettingsSchema");
const { logcheckRules } = require("../../utils/logcheck/rules");
const catalogStore = require("../../stores/raidplanCatalogStore");

// The German name of each feature, for a refusal or hint the server writes.
const FEATURE_NAMES = Object.freeze({
    logcheck: "Logcheck",
    lootCouncilBis: "BiS-Listen",
    simulation: "Simulation",
    raidSheet: "Raidsheet",
    softres: "Softres",
    armory: "Armory-Abruf",
    wowheadLinks: "Wowhead-Links",
    raidplanCatalog: "Raidplan-Katalog",
    dungeonTimes: "Dungeon-Bestzeiten",
});

// A rule set without `councilContent` has none of the council's content data.
const NO_COUNCIL_CONTENT = Object.freeze({ bis: false, sim: false, tiers: false, itemTable: false });

const YES = Object.freeze({ possible: true, reason: "", message: "", missing: [] });
const no = (reason, message, missing = []) => ({ possible: false, reason, message, missing });

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/** The config to read: the one handed in, else the stored one (late: configStore is far up the graph). */
function configOf(config) {
    if (config && typeof config === "object") return config;
    try {
        return require("../../stores/configStore").getConfig() || {};
    } catch {
        return {};
    }
}

/** A version id a rule set knows, "" otherwise. */
function knownId(versionId) {
    const id = str(versionId);
    return rulesFor(id) ? id : "";
}

/** The label of a known version ("WoW Forever"). */
function labelOf(versionId) {
    const rules = rulesFor(versionId);
    return (rules && rules.label) || str(versionId);
}

/** The settings block of a known version, the same shape versionSettings.settingsForVersion reads. */
function blockOf(versionId, config) {
    const cfg = configOf(config);
    const map = cfg.versionSettings && typeof cfg.versionSettings === "object" && !Array.isArray(cfg.versionSettings)
        ? cfg.versionSettings : versionSettingsOf(cfg);
    return normalizeBlock(map[versionId]);
}

/**
 * The v1 site the log check asks for a version, "" when it has none: the one its
 * log rule set fixes (TBC: the classic host the CLA port has always asked, it
 * serves the fresh reports too), else the Warcraft-Logs site of its settings.
 * @param {string} versionId
 * @param {{ config?: object }} [opts]
 */
function wclApiSite(versionId, { config } = {}) {
    const id = knownId(versionId);
    const rules = logcheckRules(str(versionId));
    if (rules && rules.apiSite) return rules.apiSite;
    return id ? wclSiteOf(blockOf(id, config).wclUrlTemplate) : "";
}

/**
 * Whether the log check can read a version, and why not — the possibility of
 * the feature "logcheck" (#747): the version's log rule set is ready AND a
 * Warcraft-Logs site is known for it.
 * @param {string} versionId
 * @param {{ config?: object }} [opts]
 * @returns {{ possible: boolean, reason: ""|"unknown_version"|"no_rules"|"rules_not_ready"|"no_site", message: string, missing: string[] }}
 *   `message` is the German reason for a tooltip, `missing` what the rule set still lacks
 */
function logcheckCapability(versionId, { config } = {}) {
    const id = knownId(versionId);
    if (!id) return no("unknown_version", "Unbekannte Spielversion.");
    const label = labelOf(id);
    const rules = logcheckRules(id);
    if (!rules) return no("no_rules", `Für ${label} gibt es keine Logcheck-Regeln.`);
    if (!rules.ready) return no("rules_not_ready", `Die Logcheck-Regeln für ${label} sind noch nicht fertig.`, [...rules.missing]);
    if (!wclApiSite(id, { config })) return no("no_site", `Für ${label} ist keine Warcraft-Logs-Seite eingetragen.`);
    return { ...YES, missing: [] };
}

/** The council's content data a version's rule set names (#748), all false without any. */
function councilData(versionId) {
    const rules = rulesFor(versionId);
    const c = rules && rules.councilContent;
    if (!c || typeof c !== "object") return { ...NO_COUNCIL_CONTENT };
    return { bis: !!c.bis, sim: !!c.sim, tiers: !!c.tiers, itemTable: !!c.itemTable };
}

/** Whether the raid plan catalog has a mob or a spell of the version (the defaults and the orga's own). */
function catalogHasEntries(versionId) {
    const mine = (e) => Array.isArray(e.versions) && e.versions.includes(versionId);
    return catalogStore.listMobs().some(mine) || catalogStore.listSpells().some(mine);
}

// Per feature: is it possible for a known version, and why not.
const POSSIBLE = {
    logcheck(id, config) {
        const cap = logcheckCapability(id, { config });
        // rules not ready AND no site: the matrix names both (`also`), the message stays the first reason
        return cap.reason === "rules_not_ready" && !wclApiSite(id, { config }) ? { ...cap, also: ["no_site"] } : cap;
    },
    // A version without BiS data of its own uses the orga's hand lists (#760, stores/manualBisStore.js).
    lootCouncilBis: () => YES,
    simulation: (id) => (councilData(id).sim ? YES : no("no_sim_data", `Für ${labelOf(id)} gibt es keine Simulationsdaten.`)),
    raidSheet: (id) => (hasSheetLayout(id) ? YES : no("no_sheet_layout", `Für ${labelOf(id)} gibt es kein Raidsheet-Layout.`)),
    softres: (id, config) => (blockOf(id, config).softresEdition
        ? YES : no("no_softres_edition", `Für ${labelOf(id)} ist keine Softres-Edition eingetragen.`)),
    armory(id, config) {
        const s = blockOf(id, config);
        return s.blizzardRegion && s.blizzardRealmSlug && s.blizzardNamespace
            ? YES : no("armory_not_configured", `Armory für ${labelOf(id)} nicht eingerichtet (Region, Realm, Namespace).`);
    },
    wowheadLinks: (id, config) => (blockOf(id, config).wowheadPath
        ? YES : no("no_wowhead_path", `Für ${labelOf(id)} ist kein Wowhead-Pfad eingetragen.`)),
    raidplanCatalog: (id) => (catalogHasEntries(id) ? YES : no("no_catalog_entries", `Der Raidplan-Katalog hat keine Einträge für ${labelOf(id)}.`)),
    dungeonTimes: (id) => (rulesFor(id) && rulesFor(id).dungeonTimes
        ? YES : no("no_dungeon_times", `Für ${labelOf(id)} gibt es keine Dungeon-Bestzeiten (kein LevelHelper).`)),
};

/** The German hint of a feature switched off for a version. */
function disabledMessage(versionId, feature) {
    return `${FEATURE_NAMES[feature] || feature} ist für ${labelOf(versionId)} ausgeschaltet (Einstellungen → Spielversion).`;
}

/**
 * One feature of one version.
 * @param {string} versionId
 * @param {string} feature  one of VERSION_FEATURES
 * @param {{ config?: object }} [opts]
 * @returns {{ feature: string, possible: boolean, enabled: boolean, on: boolean,
 *   reason: string, message: string, missing: string[], also: string[] }}
 *   `reason` "" when on, "disabled" when switched off, else why it is not possible
 *   ("unknown_version", "no_rules", "rules_not_ready", "no_site", "no_bis_data", "no_sim_data",
 *   "no_sheet_layout", "no_softres_edition", "armory_not_configured", "no_wowhead_path",
 *   "no_catalog_entries", "no_dungeon_times", "unknown_feature"); `message` the German text for it; `also` further reasons
 *   the matrix names beside it (logcheck: rules not ready and no Warcraft-Logs site)
 */
function featureState(versionId, feature, { config } = {}) {
    const f = str(feature);
    const base = { feature: f, possible: false, enabled: false, on: false, missing: [], also: [] };
    if (!isVersionFeature(f)) return { ...base, reason: "unknown_feature", message: `Unbekannte Funktion „${f}“.` };
    const id = knownId(versionId);
    if (!id) return { ...base, reason: "unknown_version", message: "Unbekannte Spielversion." };
    const cfg = configOf(config);
    const enabled = !(blockOf(id, cfg).disabled || []).includes(f);
    const can = POSSIBLE[f](id, cfg);
    if (!can.possible) return { ...base, enabled, reason: can.reason, message: can.message, missing: [...(can.missing || [])], also: [...(can.also || [])] };
    if (!enabled) return { ...base, possible: true, reason: "disabled", message: disabledMessage(id, f) };
    return { ...base, possible: true, enabled: true, on: true, reason: "", message: "" };
}

/** Whether a feature is on for a version: possible and not switched off. */
function featureOn(versionId, feature, opts) {
    return featureState(versionId, feature, opts).on;
}

/**
 * Every feature of one version — the one source (#761).
 * @param {string} versionId
 * @param {{ config?: object }} [opts]
 * @returns {Record<string, ReturnType<typeof featureState>>} keyed by feature, in VERSION_FEATURES order
 */
function versionCapabilities(versionId, opts = {}) {
    const config = configOf(opts.config);
    const out = {};
    for (const f of VERSION_FEATURES) out[f] = featureState(versionId, f, { config });
    return out;
}

/**
 * The matrix of Einstellungen → Spielversion → "Funktionen je Version": every
 * version of a rule set with every feature (GET /api/settings).
 * @param {{ config?: object }} [opts]
 * @returns {{ features: string[], versions: Record<string, Record<string, { possible, enabled, on, reason, message, missing, also }>> }}
 */
function capabilityMatrix(opts = {}) {
    const config = configOf(opts.config);
    const versions = {};
    for (const v of VERSIONS) {
        versions[v.id] = {};
        for (const [f, s] of Object.entries(versionCapabilities(v.id, { config }))) {
            versions[v.id][f] = { possible: s.possible, enabled: s.enabled, on: s.on, reason: s.reason, message: s.message, missing: s.missing, also: s.also };
        }
    }
    return { features: [...VERSION_FEATURES], versions };
}

/**
 * The loot council's content for a version (#748, #761): what its rule set has,
 * as far as it is switched on. "BiS-Listen" carries the BiS lists, the item table
 * and the tier/raid filter; "Simulation" the simulation. `off` says the BiS data
 * exists but is switched off, so the page can say so instead of "keine Daten".
 * `manualBis` (#760): the version has no BiS data of its own, so its BiS lists
 * are the orga's hand lists (stores/manualBisStore.js) — `bis` stays the data
 * lists' flag, so a TBC council never takes this path.
 * @param {string} versionId
 * @param {{ config?: object }} [opts]
 * @returns {{ bis: boolean, manualBis: boolean, sim: boolean, tiers: boolean, itemTable: boolean, off: boolean, simHint: string }}
 *   `simHint` the German reason when the simulation is not on ("" when it is)
 */
function councilContent(versionId, opts = {}) {
    const config = configOf(opts.config);
    const data = councilData(knownId(versionId));
    const bis = featureState(versionId, "lootCouncilBis", { config });
    const sim = featureState(versionId, "simulation", { config });
    return {
        bis: bis.on && data.bis,
        manualBis: bis.on && !data.bis,
        tiers: bis.on && data.tiers,
        itemTable: bis.on && data.itemTable,
        sim: sim.on && data.sim,
        off: bis.possible && !bis.on,
        simHint: sim.on ? "" : (sim.reason === "disabled" ? sim.message : "Für diese Spielversion gibt es keine Simulation."),
    };
}

/**
 * Whether a raid of a version may fill the Google raid sheet: the feature
 * "raidSheet" — the rule set has a sheet layout (TBC only, #751) and it is not
 * switched off. The raid detail plans every other raid with the raid plan.
 */
function sheetOffered(versionId, opts) {
    return featureOn(versionId, "raidSheet", opts);
}

/**
 * The refusal of a sheet fill for a raid of a version (POST /api/raids/fill,
 * /fillsetup): null when sheetOffered, else a 409 — `no_sheet_layout` naming the
 * version (#751; filling would write a wrongly filled TBC sheet), `feature_off`
 * when the orga switched the raid sheet off for the version (#761).
 */
function sheetVersionRefusal(versionId, opts) {
    const state = featureState(versionId, "raidSheet", opts);
    if (state.on) return null;
    if (state.reason === "disabled") return { status: 409, code: "feature_off", message: `${state.message} Plane diesen Raid mit dem Raidplan.` };
    return {
        status: 409,
        code: "no_sheet_layout",
        message: `Für ${labelOf(versionId)} gibt es keine Raidsheet-Vorlage – das Google-Sheet lässt sich nur für TBC-Raids füllen. Plane diesen Raid mit dem Raidplan.`,
    };
}

/**
 * Whether a plan of a version uses the raid plan catalog (#761): a plan without
 * a version, or of a version no rule set knows, always does; a known version
 * only while "raidplanCatalog" is on. Off, the plan gets no mobs and no spells
 * (the catalog page keeps them all).
 */
function catalogEnabled(versionId, opts) {
    if (!knownId(versionId)) return true;
    return featureOn(versionId, "raidplanCatalog", opts);
}

module.exports = {
    FEATURES: VERSION_FEATURES, FEATURE_NAMES,
    versionCapabilities, featureState, featureOn, capabilityMatrix,
    logcheckCapability, wclApiSite, councilContent, sheetOffered, sheetVersionRefusal, catalogEnabled,
};
