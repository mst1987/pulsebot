// Drum ability GUIDs -> category. Covers TBC and the "fresh" re-issues.
const DRUM_TYPE = {
    35476: "Battle", 351355: "Battle",
    35475: "War", 351360: "War",
    35478: "Restoration", 351358: "Restoration",
    35477: "Speed", 351359: "Speed",
};
const DRUM_FILTER = "ability.id IN (35476,35475,35478,35477,351355,351360,351358,351359)";

/**
 * Per-player drum usage: how many drums each player cast (by type).
 * One filtered casts API call for the whole raid.
 *
 * @returns {Promise<null | Array<{name,type,total,byType}>>}
 */
async function analyzeDrums(wcl, reportId, fights) {
    const end = fights.end || 999999999999;
    let table;
    try {
        table = await wcl.getCasts(reportId, 0, end, { filter: DRUM_FILTER });
    } catch {
        return null;
    }
    const results = [];
    let icon = null;
    for (const e of (table && table.entries) || []) {
        const byType = {};
        let total = 0;
        for (const ab of e.abilities || []) {
            const cat = DRUM_TYPE[String(ab.guid)];
            if (!cat) continue;
            const n = ab.total || 0;
            byType[cat] = (byType[cat] || 0) + n;
            total += n;
            if (ab.icon && !icon) icon = ab.icon;
        }
        if (total > 0) results.push({ name: e.name, type: e.type, total, byType });
    }
    results.sort((a, b) => b.total - a.total);
    return results.length ? { players: results, icon } : null;
}

module.exports = { analyzeDrums };
