// Gear loaded from one Warcraft-Logs report on request — the loot council's
// third gear source next to the stored evaluations and the armory.
//
// The evaluations only know a raid that somebody ran the CLA on, and the armory
// only knows what is on the character *now* — between two raid nights that is
// the arena set, and it carries no enchant ids WoWSims understands. A log the
// bot has seen (or any WCL link) answers the question in between: "what did
// they wear on Thursday", with gems and enchants, without a full evaluation.
//
// Nothing here runs on a page load. Somebody presses the button for one
// raider, the report's casts table is read once, the raider's armory is built
// with the same builder the CLA uses (so a piece carries its gems and enchant
// status like any other), and the result is kept on disk under the character.
// charGear.js then prefers it over the evaluations — until an evaluation newer
// than the request lands, which is the natural end of "the set from Thursday".

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const WarcraftLogs = require("../classes/warcraftlogs");
const { buildArmory } = require("../utils/logcheck/gearIssues");
const { selectPlayers } = require("../utils/logcheck/common");
const { resolveSituationalGear } = require("../utils/logcheck/gearVariants");
const { listLogs } = require("./logStore");
const { characterKeyOf } = require("../utils/loot/lootImport");

const LOG_GEAR_FILE = settingsPath("logGear.json");

// How many of the bot's newest logs are opened when no report was named. Two
// API calls per log, so this is the cap on "load from the newest log I am in".
const MAX_LOGS = 8;

/** A failure whose message is meant for the person who pressed the button. */
class LogGearError extends Error {
    constructor(message, status = 404) {
        super(message);
        this.logGear = true;
        this.status = status;
    }
}

const store = createJsonStore({
    file: LOG_GEAR_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && typeof data.characters === "object" && data.characters ? data.characters : {}),
});

function readAll() {
    return store.read();
}

function writeAll(characters) {
    store.write({ characters });
}

/** The loaded snapshot for one character, or null. */
function getLogGear(character) {
    return readAll()[characterKeyOf(character)] || null;
}

/** Every loaded snapshot. */
function listLogGear() {
    return Object.values(readAll());
}

/** Forget a loaded snapshot; the evaluations take over again. */
function clearLogGear(character) {
    const all = readAll();
    const key = characterKeyOf(character);
    if (!all[key]) return false;
    delete all[key];
    writeAll(all);
    return true;
}

function saveSnapshot(snapshot) {
    const all = readAll();
    all[snapshot.key] = snapshot;
    writeAll(all);
}

/**
 * The bot's newest logs, as the page lists them to pick from. Newest posted
 * first; a log without a report id (never resolved) is of no use here.
 */
function recentLogs(limit = 12) {
    return listLogs()
        .filter((log) => log.reportId)
        .map((log) => ({
            reportId: log.reportId,
            title: log.title || "",
            postedAt: Number(log.postedAt) || Number(log.detectedAt) || 0,
            eventLabel: log.eventLabel || "",
            link: log.link || "",
        }))
        .sort((a, b) => b.postedAt - a.postedAt)
        .slice(0, limit);
}

/**
 * One character's gear out of one report, or null when they are not in it.
 *
 * Reads what the CLA reads — the fight list and the whole-report casts table —
 * and builds the armory with the CLA's own builder, so gems, empty sockets and
 * the enchant status come out exactly as an evaluation would carry them. A
 * boss-specific piece is resolved against the same night, like the CLA does.
 */
async function gearFromReport(wcl, reportId, character) {
    const fights = await wcl.getFights(reportId);
    const table = await wcl.getCasts(reportId, 0, fights.end || 999999999999);
    const key = characterKeyOf(character);
    const player = selectPlayers(table).find((p) => characterKeyOf(p.name) === key);
    if (!player) return null;
    const entry = { name: player.name, type: player.type, armory: buildArmory(player, { gemsToConsider: 3 }) };
    try {
        await resolveSituationalGear(wcl, reportId, fights, [entry]);
    } catch {
        // The set is still usable without the alternative; charGear drops the
        // boss-specific slot and says so.
    }
    return {
        key,
        character: player.name,
        className: player.type || "",
        reportId,
        reportTitle: String(fights.title || ""),
        reportStart: Number(fights.start) || 0,
        fetchedAt: Date.now(),
        armory: entry.armory,
    };
}

function newClient() {
    try {
        return new WarcraftLogs();
    } catch {
        throw new LogGearError("Für Warcraft Logs fehlt der API-Key (WARCRAFTLOGS_API_KEY).", 400);
    }
}

/**
 * Load a character's gear from a log and keep it.
 *
 * With a report id or link, that report and only that one — "not in this log"
 * is an answer. Without, the bot's newest logs are opened one after another
 * until one has the character; the result says how many were tried, so a
 * failure can name the number rather than just "not found".
 *
 * @returns {Promise<{snapshot: object, tried: number}>}
 * @throws {LogGearError}
 */
async function loadLogGear(character, { reportId = "", link = "", wcl = null } = {}) {
    const name = String(character || "").trim();
    if (!name) throw new LogGearError("Kein Charakter angegeben.", 400);
    const client = wcl || newClient();
    const id = WarcraftLogs.parseReportId(String(link || reportId || "").trim());
    if (id) {
        let snapshot;
        try {
            snapshot = await gearFromReport(client, id, name);
        } catch (e) {
            const status = e && e.response ? ` (HTTP ${e.response.status})` : "";
            throw new LogGearError(`Der Report konnte nicht geladen werden${status}. Stimmt der Link und ist er öffentlich?`, 400);
        }
        if (!snapshot) throw new LogGearError(`${name} steht nicht in diesem Log.`);
        saveSnapshot(snapshot);
        return { snapshot, tried: 1 };
    }

    const logs = recentLogs(MAX_LOGS);
    if (!logs.length) throw new LogGearError("Der Bot kennt noch kein Log — einen Warcraft-Logs-Link angeben.");
    let tried = 0;
    for (const log of logs) {
        tried += 1;
        let snapshot = null;
        try {
            snapshot = await gearFromReport(client, log.reportId, name);
        } catch {
            // One unreadable report is not the end of the walk.
            continue;
        }
        if (!snapshot) continue;
        saveSnapshot(snapshot);
        return { snapshot, tried };
    }
    throw new LogGearError(`${name} steht in keinem der letzten ${tried} Logs — einen Warcraft-Logs-Link angeben.`);
}

module.exports = {
    loadLogGear, gearFromReport, getLogGear, listLogGear, clearLogGear, recentLogs,
    LogGearError, MAX_LOGS, keyOf: characterKeyOf, LOG_GEAR_FILE, useFile: store.useFile,
};
