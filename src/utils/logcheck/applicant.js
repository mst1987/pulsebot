const { analyzePlayerGear } = require("./gearIssues");
const { analyzeConsumables } = require("./consumables");
const { analyzePotions } = require("./potions");

const REALM = process.env.APPLY_WCL_REALM || "thunderstrike";
const REGION = process.env.APPLY_WCL_REGION || "eu";

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
 * most recent raid. Returns null if the character has no parses.
 */
async function analyzeApplicant(wcl, characterName, classSpec = {}) {
    let parses;
    try {
        parses = await wcl.getParses(characterName, REALM, REGION, "dps");
    } catch {
        return null;
    }
    if (!Array.isArray(parses) || parses.length === 0) return null;

    const overview = parsesOverview(parses);
    const last = lastReport(parses);

    const result = { overview, last, relevant: relevantPotions(classSpec.className, classSpec.spec) };

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

module.exports = { analyzeApplicant };
