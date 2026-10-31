// One instance per raid ID, the second half: who was already in the instance
// this raid ID by its logs and its loot - also without a setup entry (a raid
// planned elsewhere, a pug, a Raid-Helper raid without a setup here).
//
//   log   a Warcraft-Logs report of the week (logStore, played at reportStart,
//         else its raid's start, else when it was posted): its instances from
//         raidSummary (`raids[].contentId`, only with a boss killed - no kill,
//         no lockout), else from its zone; its characters from the stored
//         report's roster (reportStore.getReportRoster, else `players`).
//   loot  an imported loot row of the week (lootStore, `awardedAt`): its
//         instance by item id (TBC) or by the export's instance string, its
//         version from the raid it is filed under (lootVersion), its server
//         by services/loot/lootServer.js. A row with only a date (midnight
//         UTC) counts as played at noon of that day.
//
// Each record: { source, contentIds, guildId, eventId, startTime (s), keys }.
// raidIdConflicts.js decides what counts (instance, own raid, realm) and what
// the hint may say. Names are keyed without version (nameKeyOf) - as the logs and
// the exports write them; a Forever first name alone is resolved there.
//
// Cheap: the stores hand the week's rows out of their frozen cache (peek, no
// copy), and the records of a raid ID are kept for a minute - the setup editor
// asks on every refresh.
const logStore = require("../../stores/loot/logStore");
const lootStore = require("../../stores/loot/lootStore");
const reportStore = require("../../stores/loot/reportStore");
const raidContent = require("../../config/data/raidContent");
const { DAY_MS, raidIdOf } = require("../../utils/time/raidId");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const { versionOfImport } = require("../loot/lootVersion");
const { serverContext, guildOfLootEvent } = require("../loot/lootServer");

const TTL_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const cache = new Map();

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** The instances a log covers: the raids with a kill, else its zone. */
function logContents(log) {
    const raids = Array.isArray(log.raids) ? log.raids : [];
    if (raids.length) return new Set(raids.filter((r) => r && str(r.contentId) && Number(r.killed) > 0).map((r) => str(r.contentId)));
    const zone = raidContent.contentForInstance(log.zone, { versionId: str(log.versionId) || undefined });
    return new Set(zone ? [zone] : []);
}

/** The character keys of a log's stored report. */
function logKeys(log) {
    const report = str(log.reportRefId) ? reportStore.getReportRoster(str(log.reportRefId)) : null;
    if (!report) return new Set();
    const people = report.roster.length ? report.roster : report.players;
    return new Set(people.map((p) => nameKeyOf(p && p.name)).filter(Boolean));
}

function logRecords(id) {
    const out = [];
    for (const log of logStore.logsBetween(id - DAY_MS, id + 8 * DAY_MS)) {
        const at = logStore.playedAtOf(log);
        if (raidIdOf(at) !== id) continue;
        const contentIds = logContents(log);
        if (!contentIds.size) continue;
        const keys = logKeys(log);
        if (!keys.size) continue;
        out.push({ source: "log", contentIds, guildId: str(log.guildId), eventId: str(log.eventId), startTime: Math.floor(at / 1000), keys });
    }
    return out;
}

/** When a loot row was awarded; a bare date (midnight UTC) counts as noon. */
function awardedAtOf(row) {
    const at = Number(row.awardedAt) || 0;
    return at && at % DAY_MS === 0 ? at + 12 * HOUR_MS : at;
}

function lootRecords(id) {
    const groups = new Map();
    let ctx = null;
    const versions = new Map();
    for (const row of lootStore.itemsBetween(id - DAY_MS, id + 8 * DAY_MS)) {
        const at = awardedAtOf(row);
        const key = row && nameKeyOf(row.characterKey || row.character);
        if (!key || raidIdOf(at) !== id) continue;
        const target = `${str(row.eventId)}|${str(row.categoryId)}`;
        if (!versions.has(target)) versions.set(target, versionOfImport({ eventId: str(row.eventId), categoryId: str(row.categoryId) }));
        const { contentId } = raidContent.contentForLoot(row, { versionId: versions.get(target) });
        if (!contentId) continue;
        if (!ctx) ctx = serverContext();
        const guildId = guildOfLootEvent(ctx, row.eventId, row.categoryId, row.guildId);
        const g = `${target}|${guildId}|${contentId}`;
        if (!groups.has(g)) {
            groups.set(g, { source: "loot", contentIds: new Set([contentId]), guildId, eventId: str(row.eventId), startTime: Math.floor(at / 1000), keys: new Set() });
        }
        const rec = groups.get(g);
        rec.keys.add(key);
        rec.startTime = Math.min(rec.startTime, Math.floor(at / 1000));
    }
    return [...groups.values()];
}

/**
 * The log and loot records of raid ID `id` (ms, raidIdOf), kept for a minute.
 * A source that fails to read is left out - the hint is a hint.
 */
function historyOfRaidId(id, now = Date.now()) {
    if (id === null || id === undefined) return [];
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) return hit.records;
    const records = [];
    for (const read of [logRecords, lootRecords]) {
        try {
            records.push(...read(id));
        } catch {
            // a broken store file must not break the setup editor
        }
    }
    cache.set(id, { at: now, records });
    // keep only a few weeks: the editor looks at one, the proposal at one or two
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    return records;
}

/** Forget the kept records (tests, and after an import that should show at once). */
function clearHistoryCache() {
    cache.clear();
}

module.exports = { historyOfRaidId, clearHistoryCache };
