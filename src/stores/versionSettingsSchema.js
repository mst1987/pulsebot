// The shape of config.versionSettings (#542): one block per game version with
// the Battle.net realm, the armory and Warcraft Logs templates, the Wowhead
// path, the softres edition and the version's default raidsheet. Pure
// normalisers only, read by configSchema.js; what the values are used for is
// services/events/versionSettings.js.
//
//   blizzardRegion      "eu" | "us" | "kr" | "tw" | ""   Battle.net API region
//   blizzardRealmSlug   "thunderstrike"                   realm of the profile lookup
//   blizzardNamespace   "profile-classicann-eu"           profile API namespace
//   armoryUrlTemplate   "https://…/{char}"                armory page of a character
//   wclUrlTemplate      "https://…/{char}"                Warcraft Logs page of a character
//   wowheadPath         "tbc"                             www.wowhead.com/<path>/item=…
//   softresEdition      "classic" | "tbc" | "wotlk" | ""  softres.it edition
//   raidsheetId         id of a raidsheet (Einstellungen → Raidsheets)
//
// A value that does not pass is "", and "" means "not there for this version".
const { VERSIONS, LEGACY_VERSION } = require("../config/gameVersions");
const { INSTANCES: SOFTRES_INSTANCES } = require("../config/softresInstances");
const vars = require("../config/variables");

const FIELDS = [
    "blizzardRegion", "blizzardRealmSlug", "blizzardNamespace",
    "armoryUrlTemplate", "wclUrlTemplate", "wowheadPath", "softresEdition", "raidsheetId",
];

const REGIONS = ["eu", "us", "kr", "tw"];
const SOFTRES_EDITIONS = [...new Set(Object.values(SOFTRES_INSTANCES).map((i) => i.edition))];
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const RAIDSHEET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEMPLATE_MAX = 300;

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/** A URL template with a {char} placeholder that is a well-formed http(s) address once filled, else "". */
function normalizeTemplate(raw) {
    const text = str(raw);
    if (!text || text.length > TEMPLATE_MAX || !text.includes("{char}")) return "";
    const filled = text.replace(/\{char\}/g, "x");
    if (!/^https?:\/\/[^\s<>()"]+$/i.test(filled)) return "";
    try {
        return new URL(filled).hostname ? text : "";
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
    return {
        blizzardRegion: REGIONS.includes(region) ? region : "",
        blizzardRealmSlug: SLUG.test(realm) ? realm : "",
        blizzardNamespace: SLUG.test(namespace) ? namespace : "",
        armoryUrlTemplate: normalizeTemplate(src.armoryUrlTemplate),
        wclUrlTemplate: normalizeTemplate(src.wclUrlTemplate),
        wowheadPath: SLUG.test(wowhead) ? wowhead : "",
        softresEdition: SOFTRES_EDITIONS.includes(edition) ? edition : "",
        raidsheetId: RAIDSHEET_ID.test(sheet) ? sheet : "",
    };
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
    });
}

/**
 * The per-version settings a stored config.json stands for: its own map when
 * it has one, else (a config from before #542, until the start-up migration
 * wrote it down) the old single values as the TBC block.
 */
function versionSettingsOf(stored) {
    const src = stored && typeof stored === "object" ? stored : {};
    if (src.versionSettings && typeof src.versionSettings === "object" && !Array.isArray(src.versionSettings)) {
        return normalizeVersionSettings(src.versionSettings);
    }
    return normalizeVersionSettings({ [LEGACY_VERSION]: legacyTbcBlock(src) });
}

module.exports = {
    FIELDS, REGIONS, SOFTRES_EDITIONS,
    normalizeTemplate, normalizeBlock, normalizeVersionSettings, legacyTbcBlock, versionSettingsOf,
};
