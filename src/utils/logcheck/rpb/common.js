// Shared helpers for the RPB (Role Performance Breakdown) analyzers.
//
// Ported from the RPB Apps Script (reference/rpb/appsscript/). The original is one
// 4.6k-line function that writes straight into a spreadsheet; here the analysis is
// split per topic and returns plain data.
const rpbData = require("../../../config/rpbData");

const { EXCLUDED_ENCOUNTER_ID, HASTE_RATING_PER_PERCENT } = rpbData;

// The roles the RPB groups its whole breakdown by.
const ROLES = ["Tank", "Healer", "Caster", "Physical"];

/** WCL filter expression excluding Kalecgos, which the RPB drops from every number. */
const EXCLUDE_KALECGOS = `encounterid != ${EXCLUDED_ENCOUNTER_ID}`;

/** Boss fights of a report, minus the excluded encounter. */
function bossFights(fights) {
    return (fights.fights || []).filter(
        (f) => f.boss > 0 && !String(f.boss).endsWith(String(EXCLUDED_ENCOUNTER_ID)),
    );
}

/** Trash fights (boss === 0). */
function trashFights(fights) {
    return (fights.fights || []).filter((f) => !f.boss || f.boss === 0);
}

/**
 * Total combat time in ms across the fights the report covers, excluding Kalecgos.
 * The RPB divides its "seconds active" by this to get the relative activity.
 */
function totalFightTime(fights, { bossesOnly = false } = {}) {
    const list = bossesOnly ? bossFights(fights) : (fights.fights || []).filter(
        (f) => !String(f.boss || 0).endsWith(String(EXCLUDED_ENCOUNTER_ID)),
    );
    return list.reduce((sum, f) => sum + Math.max(0, f.end_time - f.start_time), 0);
}

/**
 * Decide a player's role the way the RPB does: count the roles WCL reported for
 * them across all boss fights and pick the majority, with class-specific
 * tie-breaks (a Balance druid / Elemental shaman counts as Caster, everything
 * else feral/enhancement counts as Physical).
 *
 * @param {string} playerClass  WCL class name ("Druid", "Mage", ...)
 * @param {{dps:number, tank:number, healer:number, dpsSpec:string}} counts
 * @returns {string} one of ROLES
 */
function roleForClass(playerClass, counts) {
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
        return "Physical";
    }
}

/**
 * Walk the per-boss summary responses and collect, per player id, the role counts
 * WCL reported plus the spell haste rating carried by their gear.
 *
 * @param {Array<object>} summaries  one report/tables/summary response per boss fight
 * @returns {{ roleCounts: object, gearSpellHaste: object, trinkets: object }}
 */
function collectFromSummaries(summaries) {
    const roleCounts = {};   // id -> { dps, tank, healer, dpsSpec }
    const gearSpellHaste = {}; // name -> haste rating (max seen across fights)
    const trinkets = {};     // name -> { itemName: count }

    for (const summary of summaries) {
        if (!summary) continue;
        for (const member of summary.composition || []) {
            const rec = roleCounts[member.id] || (roleCounts[member.id] = { dps: 0, tank: 0, healer: 0, dpsSpec: "" });
            for (const spec of member.specs || []) {
                if (!spec.role) continue;
                if (spec.role === "healer") rec.healer++;
                else if (spec.role === "tank") rec.tank++;
                else if (spec.role === "dps") {
                    rec.dps++;
                    if (spec.spec) rec.dpsSpec = spec.spec;
                }
            }
        }

        const details = summary.playerDetails || {};
        for (const group of [details.dps, details.healers, details.tanks]) {
            for (const player of group || []) {
                const gear = (player.combatantInfo && player.combatantInfo.gear) || [];
                let haste = 0;
                for (const item of gear) {
                    if (!item || !item.id || String(item.id) === "0") continue;
                    // slots 3 (shirt) and 18 (tabard) never carry stats
                    if (item.slot === 3 || item.slot === 18) continue;
                    haste += rpbData.SPELL_HASTE_ITEMS[String(item.id)] || 0;
                    for (const gem of item.gems || []) {
                        if (gem && gem.id) haste += rpbData.SPELL_HASTE_ITEMS[String(gem.id)] || 0;
                    }
                    // trinket slots
                    if (item.slot === 12 || item.slot === 13) {
                        const bag = trinkets[player.name] || (trinkets[player.name] = {});
                        const itemName = item.name || `Item ${item.id}`;
                        bag[itemName] = (bag[itemName] || 0) + 1;
                    }
                }
                if (haste > (gearSpellHaste[player.name] || 0)) gearSpellHaste[player.name] = haste;
            }
        }
    }
    return { roleCounts, gearSpellHaste, trinkets };
}

/**
 * Convert a haste rating into the divisor the RPB applies to cast times
 * (TBC: 15.77 rating = 1%).
 */
function hasteDivisor(hasteRating) {
    return 1 + ((hasteRating / HASTE_RATING_PER_PERCENT) / 100);
}

/** Sum the `total` of every entry whose guid is in `ids`. */
function sumForIds(entries, ids) {
    const wanted = new Set(ids.map(String));
    let total = 0;
    for (const e of entries || []) {
        if (wanted.has(String(e.guid))) total += e.total || 0;
    }
    return total;
}

/** Format ms as "1h 23m" / "4m 12s" for headings. */
function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

module.exports = {
    ROLES,
    EXCLUDE_KALECGOS,
    bossFights,
    trashFights,
    totalFightTime,
    roleForClass,
    collectFromSummaries,
    hasteDivisor,
    sumForIds,
    formatDuration,
};
