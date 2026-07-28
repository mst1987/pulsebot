// RPB (Role Performance Breakdown) — orchestrates the individual analyzers and
// returns one structured result grouped by role, mirroring what the original
// spreadsheet produces across its Tank/Healer/Caster/Physical sheets.
//
// This is the RPB counterpart to the CLA analyzers that already live one level up
// (gearIssues, consumables, drums, ...). The two do not overlap: the CLA covers
// gear and consumables, the RPB covers performance.
const rpbData = require("../../../config/rpbData");
const { ROLES, EXCLUDE_KALECGOS, collectFromSummaries, roleForClass, bossFights, totalFightTime } = require("./common");
const { analyzeDamage } = require("./damage");
const { analyzeActivity } = require("./activity");
const { analyzeInterrupts, usageForPlayer, bossSecondsOf } = require("./usage");
const { analyzeValidation } = require("./validate");

/**
 * Fetch one report/tables/summary per boss fight. These carry the raid
 * composition (for roles) and the gear snapshot (for spell haste + trinkets).
 */
async function fetchBossSummaries(wcl, reportId, fights) {
    const out = [];
    for (const f of bossFights(fights)) {
        try {
            out.push(await wcl.getSummary(reportId, f.start_time, f.end_time));
        } catch {
            // a single boss failing is not fatal — roles fall back to the majority
            // of the remaining fights
        }
    }
    return out;
}

/**
 * Run the full RPB analysis.
 *
 * @param {WarcraftLogs} wcl
 * @param {string} reportId
 * @param {object} fights   WCL fights response
 * @param {Array<{id,name,type}>} players  selected players (see logcheck/common.js)
 * @returns {Promise<null | object>}
 */
async function analyzeRpb(wcl, reportId, fights, players) {
    if (!players || players.length === 0) return null;
    const end = fights.end || 999999999999;

    const summaries = await fetchBossSummaries(wcl, reportId, fights);
    const { roleCounts, gearSpellHaste, trinkets } = collectFromSummaries(summaries);

    // role per player, with the class-specific tie-breaks of the original
    const roles = {};
    for (const p of players) {
        roles[p.name] = roleForClass(p.type, roleCounts[p.id] || {});
    }

    const bossSeconds = bossSecondsOf(fights);

    // Per-player tables, fetched once and shared by the usage and activity
    // analyzers: the full cast table, a trash-only one, and the buffs (needed for
    // the haste correction).
    const tables = {};
    const usage = [];
    for (const p of players) {
        let all = null;
        let trash = null;
        let buffs = null;
        try {
            all = await wcl.getCasts(reportId, 0, end, { sourceid: p.id, filter: EXCLUDE_KALECGOS });
        } catch {
            continue;
        }
        try {
            trash = await wcl.getCasts(reportId, 0, end, { sourceid: p.id, encounter: 0, filter: EXCLUDE_KALECGOS });
        } catch {
            // without the trash table everything counts as boss usage
        }
        try {
            buffs = await wcl.getBuffs(reportId, 0, end, { sourceid: p.id, filter: EXCLUDE_KALECGOS });
        } catch {
            // buffs only feed the haste correction
        }
        tables[p.name] = { casts: all, buffs };
        usage.push(usageForPlayer(p, (all && all.entries) || [], (trash && trash.entries) || [], bossSeconds));
    }

    // the remaining analyzers run independently; a failure must not sink the rest
    let damage = null;
    let activity = null;
    let interrupts = null;
    let validation = null;
    try { damage = await analyzeDamage(wcl, reportId, fights, players); } catch (e) { console.error("rpb damage failed:", e.message); }
    try { activity = analyzeActivity(fights, players, tables, gearSpellHaste); } catch (e) { console.error("rpb activity failed:", e.message); }
    try { interrupts = await analyzeInterrupts(wcl, reportId, fights); } catch (e) { console.error("rpb interrupts failed:", e.message); }
    try { validation = await analyzeValidation(wcl, reportId, fights); } catch (e) { console.error("rpb validation failed:", e.message); }

    // group the roster by role for the role-oriented output
    const byRole = {};
    for (const role of ROLES) byRole[role] = [];
    for (const p of players) {
        const role = roles[p.name] || "Physical";
        (byRole[role] || (byRole[role] = [])).push({
            name: p.name,
            type: p.type,
            trinkets: Object.entries(trinkets[p.name] || {})
                .sort((a, b) => b[1] - a[1])
                .map(([itemName, count]) => ({ itemName, count })),
        });
    }

    return {
        roles,
        byRole,
        raidSeconds: Math.round(totalFightTime(fights) / 1000),
        bossSeconds,
        damage,
        activity,
        interrupts,
        validation,
        usage,
        headings: rpbData.HEADINGS,
    };
}

/** Short summary lines for the Discord reply / report overview. */
function rpbSummaryLines(rpb) {
    if (!rpb) return [];
    const lines = [];
    const roleCounts = Object.entries(rpb.byRole || {})
        .filter(([, list]) => list.length)
        .map(([role, list]) => `${role} ${list.length}`)
        .join(", ");
    if (roleCounts) lines.push(`🎭 Rollen: ${roleCounts}`);
    if (rpb.damage) {
        const deaths = rpb.damage.players.reduce((n, p) => n + p.deaths, 0);
        lines.push(`💀 Tode: **${deaths}**`);
    }
    if (rpb.interrupts) lines.push(`🛑 Unterbrechungen: ${rpb.interrupts.players.length} Spieler`);
    if (rpb.validation && rpb.validation.valid !== null) {
        lines.push(rpb.validation.valid ? "✅ Log erfüllt die Trash-Anforderungen" : "⚠️ Trash-Anforderungen nicht erfüllt");
    }
    return lines;
}

module.exports = { analyzeRpb, rpbSummaryLines, fetchBossSummaries };
