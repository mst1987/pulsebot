// Sunder Armor stacking analysis. Uses debuff events (which carry the resulting
// stack count + the applying player) so it also captures Devastate-applied stacks.
const APPLY_TYPES = new Set(["applydebuff", "applydebuffstack", "refreshdebuff"]);

/**
 * Per-player Sunder Armor applications and how many landed while the boss had
 * fewer than 5 stacks (i.e. stack-building rather than maintenance at cap).
 *
 * @param {WarcraftLogs} wcl
 * @param {string} reportId
 * @param {object} fights   WCL fights response
 * @param {object} idToPlayer  { [sourceId]: { name, type } }
 * @returns {Promise<null | Array<{name,type,total,below5}>>}
 */
async function analyzeSunder(wcl, reportId, fights, idToPlayer) {
    const end = fights.end || 999999999999;
    let events;
    try {
        events = await wcl.getAllEvents(reportId, "debuffs", 0, end, { hostility: 1, filter: "ability.name=\"Sunder Armor\"" });
    } catch {
        return null;
    }
    const bySource = {};
    for (const ev of events) {
        if (!APPLY_TYPES.has(ev.type) || ev.sourceID === undefined || ev.sourceID === null) continue;
        const rec = bySource[ev.sourceID] || (bySource[ev.sourceID] = { total: 0, below5: 0 });
        const stack = ev.stack || 1; // applydebuff = first stack
        rec.total++;
        if (stack < 5) rec.below5++;
    }
    const rows = [];
    for (const [sid, rec] of Object.entries(bySource)) {
        const p = idToPlayer[sid];
        if (!p) continue; // ignore non-raider / pet sources
        rows.push({ name: p.name, type: p.type, total: rec.total, below5: rec.below5 });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows.length ? rows : null;
}

module.exports = { analyzeSunder };
