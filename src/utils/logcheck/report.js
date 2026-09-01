const WarcraftLogs = require("../../classes/warcraftlogs");
const { buildGearIssues, buildArmory } = require("./gearIssues");
const { analyzeConsumables } = require("./consumables");
const { analyzeShadowResi } = require("./shadowResi");
const { analyzeDrums } = require("./drums");
const { analyzePotions, potionsByName } = require("./potions");
const { analyzeSunder } = require("./sunder");
const { analyzeBossUptimes } = require("./bossUptimes");
const { analyzeRpb, rpbSummaryLines } = require("./rpb");
const { selectPlayers } = require("./common");
const { analyzeRaidProgress, progressSummary } = require("./raidProgress");
const { saveReport, getReport } = require("../../web/reportStore");
const { publicBaseUrl } = require("../../config/variables");

// A user-facing failure whose message is safe to show directly.
class ReportError extends Error {}

/**
 * The raid was still running: its final boss is not down yet. Thrown before any
 * of the expensive analysis happens, and carries the progress so the caller can
 * offer "evaluate anyway" (opts.force) with the actual reason in hand.
 */
class IncompleteRaidError extends ReportError {
    constructor(progress) {
        super(`Der Raid sieht noch nicht abgeschlossen aus. ${progressSummary(progress)}`);
        this.progress = progress;
        // Callers branch on this flag rather than `instanceof`: they are spread
        // over the bot and the web api, and every one of them mocks this module
        // in its tests — a mock without the class turns `instanceof` into a
        // TypeError, which would swallow the real error behind it.
        this.incomplete = true;
    }
}

// In-flight guard keyed by WCL report id + the sections being built, so a double
// form submit (or two tabs) racing on the same link joins the build already
// underway instead of spending several seconds of API calls twice and leaving two
// duplicate report entries. CLA and RPB are keyed apart so clicking both buttons
// in quick succession runs them side by side rather than returning one for both.
const inFlight = new Map();

// The two analysis halves a report can carry.
const SECTION_CLA = "cla";
const SECTION_RPB = "rpb";
const ALL_SECTIONS = [SECTION_CLA, SECTION_RPB];

/** Normalise the sections option to a clean, ordered list. */
function normalizeSections(sections) {
    if (!sections) return [...ALL_SECTIONS];
    const list = Array.isArray(sections) ? sections : [sections];
    const wanted = ALL_SECTIONS.filter((s) => list.includes(s));
    return wanted.length ? wanted : [...ALL_SECTIONS];
}

/**
 * Build a logcheck report from a WCL link/id. Shared by the /logcheck Discord
 * command, the log-channel buttons and the web admin CLA panel.
 * Returns { id, url, report }.
 *
 * @param {string} link
 * @param {object} [opts]
 * @param {string|string[]} [opts.sections]  "cla", "rpb" or both (default: both)
 * @param {string} [opts.mergeIntoId]  existing report id to merge the result into,
 *   so both halves of a log end up on one page under one link
 * @param {boolean} [opts.force]  build even though the raid's final boss is not
 *   down yet — the deliberate answer to an IncompleteRaidError
 * @throws {ReportError} with a user-friendly message on any expected failure
 * @throws {IncompleteRaidError} when the raid is still running and force is not set
 */
async function buildReport(link, opts = {}) {
    const reportId = WarcraftLogs.parseReportId(link);
    if (!reportId) {
        throw new ReportError("Konnte keine Report-ID aus dem Link lesen.");
    }
    const sections = normalizeSections(opts.sections);
    // A forced build must not join an in-flight one that is about to refuse, and
    // vice versa — they answer different questions about the same report.
    const key = `${reportId}:${sections.join("+")}${opts.force ? ":force" : ""}`;
    const running = inFlight.get(key);
    if (running) return running;
    const build = buildReportForId(reportId, sections, opts.mergeIntoId, !!opts.force)
        .finally(() => inFlight.delete(key));
    inFlight.set(key, build);
    return build;
}

async function buildReportForId(reportId, sections, mergeIntoId, force) {
    const wantCla = sections.includes(SECTION_CLA);
    const wantRpb = sections.includes(SECTION_RPB);
    let wcl;
    try {
        wcl = new WarcraftLogs();
    } catch {
        throw new ReportError("WCL-API-Key fehlt (WARCRAFTLOGS_API_KEY in .env).");
    }

    let fights;
    try {
        fights = await wcl.getFights(reportId);
    } catch (e) {
        const status = e.response ? ` (HTTP ${e.response.status})` : "";
        throw new ReportError(`Report konnte nicht geladen werden${status}. Stimmt der Link und ist der Report öffentlich?`);
    }

    // Before anything expensive: has the raid actually ended? The fight list is
    // the one request this needs, and it is the one already made — so a refusal
    // costs a single call instead of the dozens the analysis would spend.
    const progress = analyzeRaidProgress(fights);
    if (!force && !progress.complete) throw new IncompleteRaidError(progress);

    let table;
    try {
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
    if (wantCla) {
        try { consumables = await analyzeConsumables(wcl, reportId, fights, playerEntries); } catch (e) { console.error("consumables failed:", e.message); }
        try { drums = await analyzeDrums(wcl, reportId, fights); } catch (e) { console.error("drums failed:", e.message); }
        try { potions = await analyzePotions(wcl, reportId, fights); } catch (e) { console.error("potions failed:", e.message); }
        try { shadowResi = analyzeShadowResi(table, fights); } catch (e) { console.error("shadowResi failed:", e.message); }
        try { sunder = await analyzeSunder(wcl, reportId, fights, idToPlayer); } catch (e) { console.error("sunder failed:", e.message); }
        try { bossUptimes = await analyzeBossUptimes(wcl, reportId, fights); } catch (e) { console.error("bossUptimes failed:", e.message); }
    }

    // RPB (Role Performance Breakdown) — the performance half of the analysis.
    // Considerably more API calls than the CLA sections, so it runs last and its
    // failure leaves the rest of the report intact.
    let rpb = null;
    if (wantRpb) {
        try { rpb = await analyzeRpb(wcl, reportId, fights, playerEntries); } catch (e) { console.error("rpb failed:", e.message); }
    }

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

    let report = {
        title: fights.title || reportId,
        zone: fights.zoneName || (fights.zone ? String(fights.zone) : ""),
        date: fights.start ? new Date(fights.start).toLocaleString("de-DE") : "",
        reportId,
        reportUrl: `https://classic.warcraftlogs.com/reports/${reportId}`,
        generatedAt: Date.now(),
        sections,
        // Kept on the report so a page built over a still-running raid says so,
        // instead of the reader having to remember that it was forced.
        raidProgress: progress,
        players,
        consumables,
        shadowResi,
        drums,
        potions,
        sunder,
        bossUptimes,
        rpb,
        roster,
        icons,
    };

    // When the other half of this log was already evaluated, fold this result into
    // that page instead of creating a second one — the Discord link stays valid and
    // simply gains the new tabs.
    const existing = mergeIntoId ? getReport(mergeIntoId) : null;
    if (existing) report = mergeReports(existing, report, sections);

    const id = saveReport(report, existing ? mergeIntoId : undefined);
    const url = `${publicBaseUrl}/r/${id}`;
    return { id, url, report };
}

/**
 * Fold a freshly built half into an existing report. Only the sections that were
 * just computed are taken from `fresh`; everything else is kept from `existing`,
 * so re-running the CLA never wipes an RPB result that is already on the page.
 */
function mergeReports(existing, fresh, sections) {
    const merged = { ...existing };
    // shared meta always follows the newer run
    for (const key of ["title", "zone", "date", "reportId", "reportUrl", "generatedAt", "players"]) {
        if (fresh[key] !== undefined && fresh[key] !== null) merged[key] = fresh[key];
    }
    merged.roster = mergeRoster(existing.roster, fresh.roster, sections);
    if (sections.includes(SECTION_CLA)) {
        for (const key of ["consumables", "shadowResi", "drums", "potions", "sunder", "bossUptimes"]) {
            merged[key] = fresh[key];
        }
        merged.icons = { ...(existing.icons || {}), ...(fresh.icons || {}) };
    }
    if (sections.includes(SECTION_RPB)) {
        merged.rpb = fresh.rpb;
    }
    merged.sections = [...new Set([...(existing.sections || []), ...sections])];
    return merged;
}

/**
 * The roster is shared by both halves, but not every field in it is.
 *
 * Armory and gear issues are computed on every run, so the fresh roster is the
 * right base. The potion counts are not: they come from the CLA analyzers, so an
 * RPB-only run builds them as zeros. Taking that roster wholesale used to blank
 * the Potions column of an already-evaluated CLA half — the Tränke tab kept its
 * numbers (it reads report.potions) while the Raider tab showed nothing but 0s.
 */
function mergeRoster(existingRoster, freshRoster, sections) {
    // An empty fresh roster means the run could not resolve the raid at all; the
    // roster already on the page is better than none.
    const fresh = (freshRoster && freshRoster.length) ? freshRoster : (existingRoster || []);
    if (sections.includes(SECTION_CLA)) return fresh;
    const byName = new Map((existingRoster || []).map((p) => [p.name, p]));
    return fresh.map((p) => {
        const previous = byName.get(p.name);
        return previous && previous.potions ? { ...p, potions: previous.potions } : p;
    });
}

// Report fields each half owns. Only these are dropped when a half is discarded;
// the shared meta (title, players, roster, ...) belongs to the page itself.
const CLA_FIELDS = ["consumables", "shadowResi", "drums", "potions", "sunder", "bossUptimes"];
const RPB_FIELDS = ["rpb"];

/**
 * Remove one half's data from a report, keeping the other half intact.
 *
 * Used when an evaluation is discarded — typically an RPB run that was cut short
 * and produced partial numbers — so it can be re-run without also throwing away
 * the CLA result sitting on the same page.
 *
 * @returns {{ report: object, remaining: string[] }}
 */
function stripSection(report, section) {
    const stripped = { ...report };
    for (const key of section === SECTION_RPB ? RPB_FIELDS : CLA_FIELDS) {
        stripped[key] = null;
    }
    const before = Array.isArray(report.sections) && report.sections.length
        ? report.sections
        : [...ALL_SECTIONS].filter((s) => (s === SECTION_RPB ? report.rpb : report.consumables));
    const remaining = before.filter((s) => s !== section);
    stripped.sections = remaining;
    return { report: stripped, remaining };
}

/**
 * Short human-readable summary lines for a built report (Discord/UI).
 *
 * @param {object} report
 * @param {string|string[]} [only]  restrict the lines to one half ("cla"/"rpb");
 *   used by the log-channel buttons so a CLA run does not report RPB numbers that
 *   happen to sit on the same merged page.
 */
function reportSummaryLines(report, only) {
    const wanted = only ? normalizeSections(only) : [...ALL_SECTIONS];
    const players = report.players || [];
    const roster = report.roster || [];
    const gearIssues = players.reduce((n, p) => n + (p.issues || []).length, 0);
    const lines = [`👥 Raider: **${roster.length}**`];
    if (wanted.includes(SECTION_CLA)) {
        lines.push(
            `🛡️ Gear: **${players.length}** mit **${gearIssues}** Problem(en)`,
            report.consumables && report.consumables.players.length ? `🧪 Consumables: ${report.consumables.players.length}` : "",
            report.potions ? `⚗️ Potions: ${report.potions.players.length}` : "",
            report.shadowResi ? `🌑 Shadow-Resi (${report.shadowResi.boss}): ${report.shadowResi.players.length}` : "",
            report.drums ? `🥁 Drums: ${report.drums.players.length}` : "",
            report.sunder ? `🪓 Sunder: ${report.sunder.length} Spieler` : "",
            report.bossUptimes ? `📊 Boss-Uptimes: ${report.bossUptimes.rows.length} Kämpfe` : "",
        );
    }
    if (wanted.includes(SECTION_RPB)) {
        lines.push(...rpbSummaryLines(report.rpb));
    }
    return lines.filter(Boolean);
}

module.exports = {
    buildReport,
    mergeRoster,
    reportSummaryLines,
    normalizeSections,
    stripSection,
    ReportError,
    IncompleteRaidError,
    SECTION_CLA,
    SECTION_RPB,
    ALL_SECTIONS,
};
