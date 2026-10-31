// The shape of config.versionSettings (#542): one block per game version with
// the Battle.net realm, the armory and Warcraft Logs templates, the Wowhead
// path, the softres edition and the version's default raidsheet. Pure
// normalisers only, read by configSchema.js; what the values are used for is
// services/versions/versionSettings.js.
//
//   blizzardRegion      "eu" | "us" | "kr" | "tw" | ""   Battle.net API region
//   blizzardRealmSlug   "thunderstrike"                   realm of the profile lookup
//   blizzardNamespace   "profile-classicann-eu"           profile API namespace
//   armoryUrlTemplate   "https://…/{realm}/{char}"        armory page of a character
//   wclUrlTemplate      "https://…/{realm}/{char}"        Warcraft Logs page of a character
//                       ({region} and {realm} are the two fields above, #553)
//   wowheadPath         "tbc"                             www.wowhead.com/<path>/item=…
//   softresEdition      "classic" | "tbc" | "wotlk" | ""  softres.it edition
//   raidsheetId         id of a raidsheet (Einstellungen → Raidsheets)
//   color               "#rrggbb"                         the version's colour in the web admin (#742);
//                       "" = the rule set's colour (config/gameVersions/<id>.js color, see colorOf)
//   disabled            ["logcheck", …]                   the features switched off for this version (#761,
//                       config/versionFeatures.js). Only in a block that switches something off:
//                       missing = every possible feature on, so a stored config needs no migration.
//                       A list, so it is not one of FIELDS (the text fields of the form and the standard values)
//
// A value that does not pass is "", and "" means "not there for this version".
//
// Standard values per version (#553) live with the rule set
// (config/gameVersions/<id>.js `settingsDefaults`); defaultBlock() turns them
// into a block, fillDefaults() fills only a block's empty fields.
const { VERSIONS, LEGACY_VERSION } = require("../../config/gameVersions");
const { INSTANCES: SOFTRES_INSTANCES } = require("../../config/data/softresInstances");
const vars = require("../../config/variables");
const { normalizeDisabled } = require("../../config/versionFeatures");

const FIELDS = [
    "blizzardRegion", "blizzardRealmSlug", "blizzardNamespace",
    "armoryUrlTemplate", "wclUrlTemplate", "wowheadPath", "softresEdition", "raidsheetId", "color",
];

const REGIONS = ["eu", "us", "kr", "tw"];
const SOFTRES_EDITIONS = [...new Set(Object.values(SOFTRES_INSTANCES).map((i) => i.edition))];
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const RAIDSHEET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEMPLATE_MAX = 300;
const HEX_COLOR = /^#[0-9a-f]{6}$/;

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/**
 * A URL template with a {char} placeholder that is a well-formed http(s)
 * address once filled, else "". {region} and {realm} may stand in for the
 * version's Battle.net region and realm (#553) — the standard values use them,
 * so a template follows the realm field instead of repeating it.
 */
function normalizeTemplate(raw) {
    const text = str(raw);
    if (!text || text.length > TEMPLATE_MAX || !text.includes("{char}")) return "";
    const filled = text.replace(/\{(char|region|realm)\}/g, "x");
    if (!/^https?:\/\/[^\s<>()"]+$/i.test(filled)) return "";
    try {
        return new URL(filled).hostname ? text : "";
    } catch {
        return "";
    }
}

/**
 * The Warcraft Logs site of a version: the origin of its log template
 * ("https://vanilla.warcraftlogs.com"), "" without one or when it is no
 * warcraftlogs.com address — the applicant check (#553) asks this site's v1
 * API and links its reports there, the log check (#746) its reports.
 */
function wclSiteOf(template) {
    const text = str(template);
    if (!text) return "";
    try {
        const url = new URL(text.replace(/\{(char|region|realm)\}/g, "x"));
        return /(^|\.)warcraftlogs\.com$/i.test(url.hostname) && url.protocol === "https:" ? url.origin : "";
    } catch {
        return "";
    }
}

/** One version's block with every field in its final shape: a valid value or "". */
function normalizeBlock(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const region = str(src.blizzardRegion).toLowerCase();
    const realm = str(src.blizzardRealmSlug).toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");
    const namespace = str(src.blizzardNamespace).toLowerCase();
    const wowhead = str(src.wowheadPath).toLowerCase().replace(/^\/+|\/+$/g, "");
    const edition = str(src.softresEdition).toLowerCase();
    const sheet = str(src.raidsheetId);
    const color = str(src.color).toLowerCase();
    const disabled = normalizeDisabled(src.disabled);
    return {
        blizzardRegion: REGIONS.includes(region) ? region : "",
        blizzardRealmSlug: SLUG.test(realm) ? realm : "",
        blizzardNamespace: SLUG.test(namespace) ? namespace : "",
        armoryUrlTemplate: normalizeTemplate(src.armoryUrlTemplate),
        wclUrlTemplate: normalizeTemplate(src.wclUrlTemplate),
        wowheadPath: SLUG.test(wowhead) ? wowhead : "",
        softresEdition: SOFTRES_EDITIONS.includes(edition) ? edition : "",
        raidsheetId: RAIDSHEET_ID.test(sheet) ? sheet : "",
        color: HEX_COLOR.test(color) ? color : "",
        // #761: only when something is switched off (see the head)
        ...(disabled.length ? { disabled } : {}),
    };
}

/** The rule set's own colour of a version (dark theme), "" for an unknown one. */
function defaultColorOf(versionId) {
    const rules = VERSIONS.find((v) => v.id === versionId);
    return rules && HEX_COLOR.test(String(rules.color || "")) ? rules.color : "";
}

/** The colour a version shows in: the block's own, else the rule set's. */
function colorOf(block, versionId) {
    return normalizeBlock(block).color || defaultColorOf(versionId);
}

/**
 * `{ [versionId]: block }` for every version a rule set knows — unknown ids
 * drop out, a version without a stored block gets an empty one.
 */
function normalizeVersionSettings(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const v of VERSIONS) out[v.id] = normalizeBlock(src[v.id]);
    return out;
}

/** The standard values a version's rule set names (#553), {} when it has none. */
function settingsDefaultsOf(versionId) {
    const rules = VERSIONS.find((v) => v.id === versionId);
    const d = rules && rules.settingsDefaults;
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

/** The ids of the versions that have standard values — the ones the migration and the button fill. */
function versionsWithDefaults() {
    return VERSIONS.filter((v) => Object.keys(settingsDefaultsOf(v.id)).length).map((v) => v.id);
}

/**
 * The standard block of a version (#553): its rule set's settingsDefaults
 * (config/gameVersions/<id>.js) in the final shape. The region is the
 * install's, not the version's: the one handed in (the block's own), else the
 * bootstrap region (BLIZZARD_REGION / config/defaults.js), else "eu"; a
 * {region} in the namespace is written out with it. A version without
 * defaults (Forever for now) gets an all-empty block — nothing to take over.
 * @param {string} versionId
 * @param {{ region?: string }} [opts]
 */
function defaultBlock(versionId, { region } = {}) {
    const d = settingsDefaultsOf(versionId);
    if (!Object.keys(d).length) return normalizeBlock({});
    const pickRegion = [region, vars.blizzardRegion, "eu"].map((r) => str(r).toLowerCase()).find((r) => REGIONS.includes(r));
    return normalizeBlock({
        ...d,
        blizzardRegion: pickRegion,
        blizzardNamespace: str(d.blizzardNamespace).replace(/\{region\}/g, pickRegion),
    });
}

/** Every version's standard block, `{ [versionId]: block }` — what GET /api/settings hands the "Standardwerte übernehmen" button. */
function defaultVersionSettings(current) {
    const src = current && typeof current === "object" ? current : {};
    const out = {};
    for (const v of VERSIONS) out[v.id] = defaultBlock(v.id, { region: (src[v.id] || {}).blizzardRegion });
    return out;
}

/**
 * A block with its empty fields filled from the version's standard values
 * (#553) — a filled field is never touched. `filled` names what changed.
 * @returns {{ block: object, filled: string[] }}
 */
function fillDefaults(block, versionId) {
    const own = normalizeBlock(block);
    const std = defaultBlock(versionId, { region: own.blizzardRegion });
    const filled = FIELDS.filter((f) => !own[f] && std[f]);
    const out = { ...own };
    for (const f of filled) out[f] = std[f];
    return { block: out, filled };
}

/**
 * The TBC block an install from before #542 stands for: its Battle.net realm
 * block (stored in `config.blizzard`, else the env/bootstrap values) and the
 * armory/WCL templates of config/variables (APPLY_ARMORY_URL / APPLY_WCL_URL).
 * The namespace was "auto" there (empty = profile-classicann-<region>); here it
 * is written out, because an empty one now means "no armory for this version".
 */
function legacyTbcBlock(stored) {
    const bz = stored && stored.blizzard && typeof stored.blizzard === "object" ? stored.blizzard : {};
    const region = str(bz.region || vars.blizzardRegion || "eu").toLowerCase();
    return normalizeBlock({
        blizzardRegion: region,
        blizzardRealmSlug: bz.realmSlug || vars.blizzardRealmSlug || "",
        blizzardNamespace: bz.namespace || vars.blizzardNamespace || `profile-classicann-${region}`,
        armoryUrlTemplate: vars.applyArmoryUrlTemplate || "",
        wclUrlTemplate: vars.applyWclUrlTemplate || "",
        wowheadPath: "tbc",
        softresEdition: "tbc",
        raidsheetId: "",
        color: "",
    });
}

/**
 * The per-version settings a stored config.json stands for: its own map when
 * it has one, else (a fresh install, or a config from before #542 until the
 * start-up migration wrote it down) the old single values as the TBC block and
 * every other version's standard values (#553; Forever has none yet).
 */
function versionSettingsOf(stored) {
    const src = stored && typeof stored === "object" ? stored : {};
    if (src.versionSettings && typeof src.versionSettings === "object" && !Array.isArray(src.versionSettings)) {
        return normalizeVersionSettings(src.versionSettings);
    }
    const blocks = {};
    for (const v of VERSIONS) blocks[v.id] = v.id === LEGACY_VERSION ? legacyTbcBlock(src) : defaultBlock(v.id);
    return normalizeVersionSettings(blocks);
}

// --- per-server overrides (#923, epic #926) ---------------------------------
// serverSettings[guildId].versionOverrides = { [versionId]: { <field>: value } }:
// a server may use its own realm and its own armory/log templates for a
// version. Overridden per field, not per block - a field the server has not
// set reads the version block above (config.versionSettings, the standard of
// every server). Wowhead path, softres edition, raidsheet and colour stay one
// per version; the namespace is no field of its own but follows an own region
// (namespaceForRegion).
const OVERRIDE_FIELDS = ["armoryUrlTemplate", "wclUrlTemplate", "blizzardRegion", "blizzardRealmSlug"];

/**
 * The overrides of one server in their final shape: known versions only, the
 * four fields only, valid and filled values only; a version left without a
 * field drops out. An invalid value is dropped here - the settings route
 * rejects it before it is ever stored (overrideProblems).
 */
function normalizeVersionOverrides(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const v of VERSIONS) {
        const own = src[v.id];
        if (!own || typeof own !== "object" || Array.isArray(own)) continue;
        const clean = normalizeBlock(own);
        const block = {};
        for (const f of OVERRIDE_FIELDS) if (str(own[f]) && clean[f]) block[f] = clean[f];
        if (Object.keys(block).length) out[v.id] = block;
    }
    return out;
}

/**
 * The fields of a raw override map that are filled but do not pass, as
 * `[{ versionId, field }]` - what the settings route answers with a 400.
 */
function overrideProblems(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = [];
    for (const v of VERSIONS) {
        const own = src[v.id];
        if (!own || typeof own !== "object" || Array.isArray(own)) continue;
        const clean = normalizeBlock(own);
        for (const f of OVERRIDE_FIELDS) if (str(own[f]) && !clean[f]) out.push({ versionId: v.id, field: f });
    }
    return out;
}

/**
 * The Battle.net namespace for a region a server chose over the version's.
 * The stored namespace is written out ("profile-classicann-eu") and the
 * Blizzard client sends it as is - kept, a US server would ask
 * us.api.blizzard.com for an EU namespace and get a 404. So the namespace
 * follows the region: the standard region's suffix is swapped ("-eu" ->
 * "-us"), else the rule set's template with {region} is written out; a
 * namespace neither way can tell stays as it is.
 */
function namespaceForRegion(block, region, versionId) {
    const ns = str(block.blizzardNamespace);
    const stdRegion = str(block.blizzardRegion);
    if (!region || region === stdRegion) return ns;
    if (ns && stdRegion && ns.endsWith(`-${stdRegion}`)) return `${ns.slice(0, -stdRegion.length)}${region}`;
    const template = str(settingsDefaultsOf(versionId).blizzardNamespace);
    if (template.includes("{region}")) return template.replace(/\{region\}/g, region);
    return ns;
}

/**
 * A version block with a server's overrides laid over it field by field;
 * `overridden` names them. An own region takes the namespace along.
 * @param {object} block the version's normalised block (the standard)
 * @param {object} [overrides] the server's overrides of that version
 * @param {string} [versionId] the version, for its namespace template
 */
function applyVersionOverrides(block, overrides, versionId) {
    const own = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {};
    const clean = normalizeBlock(own);
    const out = { ...block };
    const overridden = [];
    for (const f of OVERRIDE_FIELDS) {
        if (str(own[f]) && clean[f]) { out[f] = clean[f]; overridden.push(f); }
    }
    if (overridden.includes("blizzardRegion")) out.blizzardNamespace = namespaceForRegion(block, out.blizzardRegion, versionId);
    return { block: out, overridden };
}
// --- end per-server overrides (#923) ----------------------------------------

module.exports = {
    FIELDS, REGIONS, SOFTRES_EDITIONS,
    normalizeTemplate, normalizeBlock, normalizeVersionSettings, legacyTbcBlock, versionSettingsOf, wclSiteOf,
    defaultColorOf, colorOf,
    settingsDefaultsOf, versionsWithDefaults, defaultBlock, defaultVersionSettings, fillDefaults,
    OVERRIDE_FIELDS, normalizeVersionOverrides, overrideProblems, applyVersionOverrides,
};
