// RPB: is this log a valid full-clear log?
//
// GDKP rules usually require a raid to actually clear the instance rather than
// skipping straight to the bosses, so the shared config sheet lists, per zone, how
// much of which trash has to die. This module checks a report against that list
// and counts the bosses killed.
//
// The requirement tables come from the config sheet's validate*Log tabs
// (reference/rpb/config/validate*.csv) via scripts/build-rpb-data.js.
const rpbData = require("../../../config/rpbData");
const { EXCLUDE_KALECGOS, bossFights } = require("./common");

// WCL zone id -> zone tag, used only to label the result. Detection itself runs
// off the killed npcs (see detectZones), because zone ids differ between the
// classic and the fresh/anniversary realms — a fresh SSC+TK report reports zone
// 1056, which the v1 /zones endpoint does not even list.
const ZONE_TAGS = {
    1007: ["Kara"],
    1010: ["SSC", "TK"],
    1011: ["BT", "MH"],
    1012: ["ZA"],
    1013: ["SW"],
    1060: ["BT", "MH"],
};

/** Zone tags suggested by the report's zone id (may be empty for fresh realms). */
function zoneTagsOf(fights) {
    return ZONE_TAGS[fights && fights.zone] || [];
}

/**
 * Count how often each hostile npc died, keyed by npc id.
 * WCL reports enemy deaths through the deaths table with hostility=1.
 */
function killsByNpcId(deathsTable, fights) {
    const counts = {};
    // fights.enemies carries id -> guid (the npc entry id used in the config)
    const guidById = {};
    for (const e of (fights && fights.enemies) || []) {
        if (e && e.id !== undefined && e.guid !== undefined) guidById[e.id] = String(e.guid);
    }
    for (const entry of (deathsTable && deathsTable.entries) || []) {
        const guid = entry.guid !== undefined && entry.guid !== null
            ? String(entry.guid)
            : guidById[entry.id];
        if (!guid) continue;
        counts[guid] = (counts[guid] || 0) + 1;
    }
    return counts;
}

/**
 * Work out which zones a report actually covers by checking which zones' trash
 * npcs show up among the kills. This is realm-agnostic, unlike the zone id.
 *
 * @param {object} kills  npc guid -> kill count
 * @returns {Array<string>} zone tags, most-matched first
 */
function detectZones(kills) {
    const scored = [];
    for (const [tag, reqs] of Object.entries(rpbData.TRASH_REQUIREMENTS)) {
        let matched = 0;
        for (const req of reqs) {
            if (req.ids.some((id) => (kills[String(id)] || 0) > 0)) matched++;
        }
        if (matched > 0) scored.push({ tag, matched });
    }
    scored.sort((a, b) => b.matched - a.matched);
    return scored.map((s) => s.tag);
}

/**
 * Validate a report against the trash requirements of the zones it covers.
 *
 * @param {WarcraftLogs} wcl
 * @param {string} reportId
 * @param {object} fights
 * @returns {Promise<null | object>}
 */
async function analyzeValidation(wcl, reportId, fights) {
    const bosses = bossFights(fights);
    const bossesKilled = bosses.filter((f) => f.kill).length;

    const end = (fights && fights.end) || 999999999999;
    let deaths = null;
    try {
        deaths = await wcl.getDeaths(reportId, 0, end, { hostility: 1, filter: EXCLUDE_KALECGOS });
    } catch {
        return null;
    }
    const kills = killsByNpcId(deaths, fights);

    // Prefer the zones the killed trash points at; fall back to the zone id.
    let zones = detectZones(kills);
    if (zones.length === 0) zones = zoneTagsOf(fights);

    const requirements = [];
    for (const tag of zones) {
        for (const req of rpbData.TRASH_REQUIREMENTS[tag] || []) {
            requirements.push({ ...req, zone: tag });
        }
    }

    if (requirements.length === 0) {
        if (bosses.length === 0) return null;
        return {
            zones,
            bossesKilled,
            bossesTotal: bosses.length,
            requirements: [],
            valid: null,
            note: "Für diese Zone sind keine Trash-Anforderungen hinterlegt.",
        };
    }

    const rows = requirements.map((req) => {
        let killed = 0;
        for (const id of req.ids) killed += kills[String(id)] || 0;
        return {
            zone: req.zone,
            label: req.label,
            name: req.name,
            minimum: req.minimum,
            killed,
            ok: killed >= req.minimum,
        };
    });

    return {
        zones,
        bossesKilled,
        bossesTotal: bosses.length,
        requirements: rows,
        valid: rows.every((r) => r.ok),
    };
}

module.exports = { analyzeValidation, zoneTagsOf, killsByNpcId, detectZones, ZONE_TAGS };
