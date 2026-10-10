// Settings per game version (#542): where a character of a version is looked
// up and where its items and spells link to. One block per rule set of
// config/gameVersions, edited in Einstellungen → Spielversion; the fields and
// their normalisers are stores/versionSettingsSchema.js.
//
// Every field may be empty, and empty means "not there for this version": no
// link (never a guessed or a TBC one), no armory request, no softres list. The
// TBC block is what the install used before (#542's migration hands the old
// single values to it); the other versions start with their rule set's
// standard values (#553, config/gameVersions settingsDefaults — Classic's are
// checked, Forever has none yet), and only empty fields are ever filled.
//
// The Battle.net credentials (client id/secret) stay one pair for all versions
// in `config.blizzard` — it is one API application.
//
// Readers ask with the version of what they show: an event's
// (mainVersion.versionOfEvent), a character's (#543 hands its own version to
// settingsForVersion), else the main version (mainVersionFor). Every link goes
// through versionLinks() and linkCheck.externalLink (#539), so a half-filled
// template yields no link rather than a broken one.
const { rulesFor } = require("../../config/gameVersions");
const { wowheadItemId } = require("../../config/wowheadItemAliases");
const schema = require("../../stores/versionSettingsSchema");
const { knownVersion, mainVersionFor } = require("./mainVersion");
const { externalLink } = require("../discord/linkCheck");

// the feature source (#761): whether Wowhead links and the armory lookup are on for a version
const capabilities = require("./versionCapabilities");

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/** The config to read: the one handed in, else the stored one (late, see mainVersion.js' configOf). */
function configOf(config) {
    if (config && typeof config === "object") return config;
    try {
        return require("../../stores/configStore").getConfig() || {};
    } catch {
        return {};
    }
}

/**
 * The settings of one version — the interface #543 calls with a character's
 * own version. An unknown or missing id reads the main version.
 * @param {string} [versionId]
 * @param {{ config?: object }} [opts]
 * @returns {{ versionId: string, blizzardRegion: string, blizzardRealmSlug: string, blizzardNamespace: string,
 *   armoryUrlTemplate: string, wclUrlTemplate: string, wowheadPath: string, softresEdition: string, raidsheetId: string, color: string }}
 */
function settingsForVersion(versionId, { config } = {}) {
    const cfg = configOf(config);
    const id = knownVersion(versionId) || mainVersionFor({ config: cfg });
    const map = cfg.versionSettings && typeof cfg.versionSettings === "object" ? cfg.versionSettings : schema.versionSettingsOf(cfg);
    return { versionId: id, ...schema.normalizeBlock(map[id]) };
}

/**
 * The colour a version shows in in the web admin (#742): its own setting, else
 * the rule set's. `custom` says the setting differs from the rule set's colour.
 * @param {string} [versionId]
 * @param {{ config?: object }} [opts]
 * @returns {{ color: string, defaultColor: string, custom: boolean }}
 */
function versionColor(versionId, opts = {}) {
    const s = settingsForVersion(versionId, opts);
    const defaultColor = schema.defaultColorOf(s.versionId);
    const color = s.color || defaultColor;
    return { color, defaultColor, custom: color !== defaultColor };
}

/**
 * Fill a {char} template; "" without template or name, or when the link would
 * not work (#539). {region} and {realm} (#553) take the version's Battle.net
 * region and realm — a template that needs one the version has not set gives
 * no link rather than one with a hole.
 * @param {string} template
 * @param {string} character
 * @param {{ region?: string, realm?: string }} [place]
 */
function fillChar(template, character, { region = "", realm = "" } = {}) {
    const name = str(character);
    if (!template || !name) return "";
    const text = String(template);
    if ((text.includes("{region}") && !str(region)) || (text.includes("{realm}") && !str(realm))) return "";
    return externalLink(text
        .replace(/\{region\}/g, encodeURIComponent(str(region)))
        .replace(/\{realm\}/g, encodeURIComponent(str(realm)))
        .replace(/\{char\}/g, encodeURIComponent(name)));
}

// The Warcraft Logs site of a log template: stores/versionSettingsSchema.js (the
// feature source, versionCapabilities.js, reads it there without this module).
const { wclSiteOf } = schema;

/**
 * The links of one version. Every builder answers "" where the version has no
 * setting — the caller leaves the link out.
 * @param {string} [versionId] see settingsForVersion
 * @param {{ config?: object }} [opts]
 */
function versionLinks(versionId, opts = {}) {
    const s = settingsForVersion(versionId, opts);
    // Wowhead links only while the feature is on for the version (#761): a path, not switched off.
    const wowheadPath = capabilities.featureOn(s.versionId, "wowheadLinks", { config: opts.config }) ? s.wowheadPath : "";
    const wowhead = (kind, id, params = []) => {
        const n = Number(id) || 0;
        if (!wowheadPath || n <= 0) return "";
        // the re-issues are TBC Anniversary's: another version's section knows no such id
        const target = kind === "item" && wowheadPath === "tbc" ? wowheadItemId(n) : n;
        const query = params && params.length ? `?${params.join("&")}` : "";
        return externalLink(`https://www.wowhead.com/${wowheadPath}/${kind}=${target}${query}`);
    };
    const place = { region: s.blizzardRegion, realm: s.blizzardRealmSlug };
    const wclSite = wclSiteOf(s.wclUrlTemplate);
    return {
        versionId: s.versionId,
        settings: s,
        armory: (character) => fillChar(s.armoryUrlTemplate, character, place),
        wcl: (character) => fillChar(s.wclUrlTemplate, character, place),
        /** The Warcraft Logs site of the version, "" without a log template. */
        wclSite,
        /** A report on the version's log site, "" without site or id. */
        wclReport: (reportId) => {
            const id = str(reportId);
            return wclSite && /^[A-Za-z0-9]+$/.test(id) ? `${wclSite}/reports/${id}` : "";
        },
        wowheadItem: (itemId, params) => wowhead("item", itemId, params),
        wowheadSpell: (spellId) => wowhead("spell", spellId),
        /** The Wowhead path links go to, "" without one or with the links switched off (#761). */
        wowheadPath,
        softresEdition: s.softresEdition,
        raidsheetId: s.raidsheetId,
    };
}

/** The label of a version for a message ("WoW Forever"), its id when unknown. */
function versionLabel(versionId) {
    const rules = rulesFor(versionId);
    return (rules && rules.label) || String(versionId || "");
}

/**
 * A Battle.net client for a version's realm, or why there is none:
 *   { client, versionId, namespace, realmSlug, region, reason: "" }       ready to ask
 *   { client: null, reason: "version_not_configured", message }          the version has no region/realm/namespace
 *   { client: null, reason: "feature_off", message }                     the armory lookup is switched off for it (#761)
 *   { client: null, reason: "not_configured", message }                  no client id/secret
 * Whether the version may ask at all is the feature "armory" of versionCapabilities.js.
 * @param {string} [versionId]
 * @param {{ config?: object }} [opts]
 */
function blizzardFor(versionId, opts = {}) {
    const cfg = configOf(opts.config);
    const s = settingsForVersion(versionId, { config: cfg });
    const creds = cfg.blizzard && typeof cfg.blizzard === "object" ? cfg.blizzard : {};
    const base = { versionId: s.versionId, namespace: s.blizzardNamespace, realmSlug: s.blizzardRealmSlug, region: s.blizzardRegion };
    const armory = capabilities.featureState(s.versionId, "armory", { config: cfg });
    if (!armory.possible) {
        return { ...base, client: null, reason: "version_not_configured", message: `Armory für ${versionLabel(s.versionId)} nicht eingerichtet (Einstellungen → Spielversion).` };
    }
    if (!armory.on) return { ...base, client: null, reason: "feature_off", message: armory.message };
    const Blizzard = require("../../classes/blizzard");
    const client = new Blizzard({
        clientId: creds.clientId || "",
        clientSecret: creds.clientSecret || "",
        region: s.blizzardRegion,
        realmSlug: s.blizzardRealmSlug,
        namespace: s.blizzardNamespace,
        versionId: s.versionId,
        wowheadPath: s.wowheadPath,
    });
    if (!client.isConfigured()) {
        return { ...base, client: null, reason: "not_configured", message: "Battle.net-Zugang nicht eingerichtet (Einstellungen → Verbindungen)." };
    }
    return { ...base, client, reason: "", message: "" };
}

module.exports = {
    FIELDS: schema.FIELDS, REGIONS: schema.REGIONS, SOFTRES_EDITIONS: schema.SOFTRES_EDITIONS,
    normalizeBlock: schema.normalizeBlock,
    settingsForVersion, versionColor, versionLinks, blizzardFor, fillChar, wclSiteOf, versionLabel,
};
