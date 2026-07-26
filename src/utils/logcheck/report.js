const WarcraftLogs = require("../../classes/warcraftlogs");
const { buildGearIssues, buildArmory } = require("./gearIssues");
const { analyzeConsumables } = require("./consumables");
const { analyzeShadowResi } = require("./shadowResi");
const { analyzeDrums } = require("./drums");
const { analyzePotions, potionsByName } = require("./potions");
const { analyzeSunder } = require("./sunder");
const { analyzeBossUptimes } = require("./bossUptimes");
const { selectPlayers } = require("./common");
const { saveReport } = require("../../web/reportStore");
const { publicBaseUrl } = require("../../config/variables");

// A user-facing failure whose message is safe to show directly.
class ReportError extends Error {}

// In-flight guard keyed by WCL report id, so a double form submit (or two tabs)
// racing on the same link joins the build already underway instead of spending
// several seconds of API calls twice and leaving two duplicate report entries.
const inFlight = new Map();

/**
 * Build a logcheck report from a WCL link/id. Shared by the /logcheck Discord
 * command and the web admin CLA panel. Returns { id, url, report }.
 * Throws ReportError with a user-friendly message on any expected failure.
 */
async function buildReport(link) {
    const reportId = WarcraftLogs.parseReportId(link);
    if (!reportId) {
        throw new ReportError("Konnte keine Report-ID aus dem Link lesen.");
    }
    const running = inFlight.get(reportId);
    if (running) return running;
    const build = buildReportForId(reportId).finally(() => inFlight.delete(reportId));
    inFlight.set(reportId, build);
    return build;
}

async function buildReportForId(reportId) {
    let wcl;
    try {
        wcl = new WarcraftLogs();
    } catch {
        throw new ReportError("WCL-API-Key fehlt (WARCRAFTLOGS_API_KEY in .env).");
    }

    let fights, table;
    try {
        fights = await wcl.getFights(reportId);
        table = await wcl.getCasts(reportId, 0, fights.end || 999999999999);
    } catch (e) {
        const status = e.response ? ` (HTTP ${e.response.status})` : "";
        throw new ReportError(`Report konnte nicht geladen werden${status}. Stimmt der Link und ist der Report öffentlich?`);
    }

    const players = buildGearIssues(table, { gemsToConsider: 3 });
    const playerEntries = selectPlayers(table);

    // these hit the API; failures should not abort the whole report
    const idToPlayer = {};
    for (const p of playerEntries) idToPlayer[p.id] = { name: p.name, type: p.type };

    let consumables = null;
    let drums = null;
    let potions = null;
    let shadowResi = null;
    let sunder = null;
    let bossUptimes = null;
    try { consumables = await analyzeConsumables(wcl, reportId, fights, playerEntries); } catch (e) { console.error("consumables failed:", e.message); }
    try { drums = await analyzeDrums(wcl, reportId, fights); } catch (e) { console.error("drums failed:", e.message); }
    try { potions = await analyzePotions(wcl, reportId, fights); } catch (e) { console.error("potions failed:", e.message); }
    try { shadowResi = analyzeShadowResi(table, fights); } catch (e) { console.error("shadowResi failed:", e.message); }
    try { sunder = await analyzeSunder(wcl, reportId, fights, idToPlayer); } catch (e) { console.error("sunder failed:", e.message); }
    try { bossUptimes = await analyzeBossUptimes(wcl, reportId, fights); } catch (e) { console.error("bossUptimes failed:", e.message); }

    // aggregate the icons captured from the API (for headers / detail page)
    const icons = {
        ...(consumables && consumables.icons),
        destruction: potions && potions.icons && potions.icons.destruction,
        haste: potions && potions.icons && potions.icons.haste,
        mana: potions && potions.icons && potions.icons.mana,
        drums: drums && drums.icon,
    };

    // per-raider detail data (armory + their issues + potions)
    const issuesByName = {};
    for (const p of players) issuesByName[p.name] = p.issues;
    const potionMap = potionsByName(potions);
    const roster = playerEntries.map((p) => ({
        name: p.name,
        type: p.type,
        armory: buildArmory(p, { gemsToConsider: 3 }),
        issues: issuesByName[p.name] || [],
        potions: potionMap[p.name] || { destruction: 0, haste: 0, mana: 0 },
    }));

    const report = {
        title: fights.title || reportId,
        zone: fights.zoneName || (fights.zone ? String(fights.zone) : ""),
        date: fights.start ? new Date(fights.start).toLocaleString("de-DE") : "",
        reportId,
        reportUrl: `https://classic.warcraftlogs.com/reports/${reportId}`,
        generatedAt: Date.now(),
        players,
        consumables,
        shadowResi,
        drums,
        potions,
        sunder,
        bossUptimes,
        roster,
        icons,
    };

    const id = saveReport(report);
    const url = `${publicBaseUrl}/r/${id}`;
    return { id, url, report };
}

/** Short human-readable summary lines for a built report (Discord/UI). */
function reportSummaryLines(report) {
    const players = report.players || [];
    const roster = report.roster || [];
    const gearIssues = players.reduce((n, p) => n + (p.issues || []).length, 0);
    return [
        `👥 Raider: **${roster.length}**`,
        `🛡️ Gear: **${players.length}** mit **${gearIssues}** Problem(en)`,
        report.consumables && report.consumables.players.length ? `🧪 Consumables: ${report.consumables.players.length}` : "",
        report.potions ? `⚗️ Potions: ${report.potions.players.length}` : "",
        report.shadowResi ? `🌑 Shadow-Resi (${report.shadowResi.boss}): ${report.shadowResi.players.length}` : "",
        report.drums ? `🥁 Drums: ${report.drums.players.length}` : "",
        report.sunder ? `🪓 Sunder: ${report.sunder.length} Spieler` : "",
        report.bossUptimes ? `📊 Boss-Uptimes: ${report.bossUptimes.rows.length} Kämpfe` : "",
    ].filter(Boolean);
}

module.exports = { buildReport, reportSummaryLines, ReportError };
