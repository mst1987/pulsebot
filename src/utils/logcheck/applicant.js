const { analyzePlayerGear } = require("./gearIssues");
const { analyzeConsumables } = require("./consumables");
const { analyzePotions } = require("./potions");

const { LEGACY_VERSION } = require("../../config/gameVersions");
const { settingsForVersion, versionLinks } = require("../../services/events/versionSettings");

// Where an applicant's parses are looked up (#553): the realm, region and
// Warcraft Logs site of the application's game version (Einstellungen →
// Spielversion). APPLY_WCL_REALM / APPLY_WCL_REGION are only the fallback of a
// TBC block without realm or region — every other version asks its settings
// alone, so a Classic application never lands on the TBC realm.

/**
 * The lookup of a version: { versionId, realm, region, site, ready }. Not
 * ready when the version has no realm, region or log site — then there is
 * nothing to ask, and the caller says so instead of guessing.
 * @param {string} [versionId] the application's version; unknown = the main version
 * @param {{ config?: object }} [opts]
 */
function applicantSource(versionId, opts = {}) {
    const s = settingsForVersion(versionId, opts);
    const legacy = s.versionId === LEGACY_VERSION;
    const realm = s.blizzardRealmSlug || (legacy ? String(process.env.APPLY_WCL_REALM || "").trim().toLowerCase() : "");
    const region = s.blizzardRegion || (legacy ? String(process.env.APPLY_WCL_REGION || "").trim().toLowerCase() : "");
    const links = versionLinks(s.versionId, opts);
    const site = links.wclSite;
    return { versionId: s.versionId, realm, region, site, reportUrl: links.wclReport, ready: Boolean(realm && region && site) };
}

// Which potion type is "appropriate" for a class/spec.
function relevantPotions(className, spec) {
    const s = String(spec || "").toLowerCase();
    const c = String(className || "").toLowerCase();
    const caster = ["mage", "warlock"].includes(c)
        || ["shadow", "balance", "elemental"].includes(s);
    const healer = ["holy", "discipline", "restoration"].includes(s);
    if (caster) return ["destruction", "mana"];
    if (healer) return ["mana"];
    return ["haste"]; // physical dps / tanks
}

// best parse per boss, highest percentile first
function parsesOverview(parses) {
    const best = new Map();
    for (const p of parses) {
        const cur = best.get(p.encounterName);
        if (!cur || p.percentile > cur.percentile) best.set(p.encounterName, p);
    }
    return [...best.values()].sort((a, b) => b.percentile - a.percentile);
}

function lastReport(parses) {
    let latest = null;
    for (const p of parses) if (!latest || p.startTime > latest.startTime) latest = p;
    return latest;
}

/**
 * Pull a character's parses + analyze the gear/consumables/potions from their
 * most recent raid, on the realm and log site of the application's version
 * (#553). Returns null if the character has no parses or the version has no
 * lookup (applicantSource().ready).
 * @param {object} wcl a WarcraftLogs client
 * @param {string} characterName
 * @param {{ className?: string, spec?: string }} [classSpec]
 * @param {{ versionId?: string, config?: object }} [opts]
 */
async function analyzeApplicant(wcl, characterName, classSpec = {}, { versionId, config } = {}) {
    const source = applicantSource(versionId, { config });
    if (!source.ready) return null;
    let parses;
    try {
        parses = await wcl.getParses(characterName, source.realm, source.region, "dps", { site: source.site });
    } catch {
        return null;
    }
    if (!Array.isArray(parses) || parses.length === 0) return null;

    const overview = parsesOverview(parses);
    const last = lastReport(parses);

    const result = {
        overview, last, relevant: relevantPotions(classSpec.className, classSpec.spec),
        versionId: source.versionId,
        reportUrl: source.reportUrl(last.reportID),
    };

    try {
        const fights = await wcl.getFights(last.reportID);
        const table = await wcl.getCasts(last.reportID, 0, fights.end || 999999999999);
        const entry = (table.entries || []).find(
            (e) => e.name && e.name.toLowerCase() === characterName.toLowerCase()
        );
        if (entry) {
            result.gearIssues = analyzePlayerGear(entry, { gemsToConsider: 3 });
            const consum = await analyzeConsumables(wcl, last.reportID, fights, [entry]);
            result.consumables = consum && consum.players[0];
            const pot = await analyzePotions(wcl, last.reportID, fights);
            result.potions = pot && pot.players.find((p) => p.name.toLowerCase() === characterName.toLowerCase());
        }
    } catch (e) {
        console.error("applicant last-raid analysis failed:", e.message);
    }
    return result;
}

module.exports = { analyzeApplicant, applicantSource };
