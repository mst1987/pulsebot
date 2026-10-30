// The Warcraft Logs guild of a Discord server, per game version (#922, epic #926):
//
//   config.serverSettings[guildId].wclGuilds = [
//       { versionId, guildName, realm, region, interval, lastRunAt, lastSuccessAt, lastResult }
//   ]
//
// The central job (wclGuildSync.js) asks WCL every `interval` minutes for the
// guild's new reports on the site of the entry's version and keeps each new one
// as a log of that server and version, like a link posted in a log channel.
// `interval` is one of INTERVALS (0 = off); `lastRunAt` (ms, every fetch: when
// the next one is due), `lastSuccessAt` (ms, only a fetch WCL answered: where
// the next fetch window starts) and `lastResult` ({ found, error, at }) are
// written by the job only, never by a settings PATCH.
const { serverSetting } = require("../discord/serverSettings");
const { knownVersion } = require("../versions/mainVersion");

/** The minutes an entry may wait between two fetches; 0 = never on its own. */
const INTERVALS = Object.freeze([0, 15, 30, 60, 180, 360, 1440]);
const DEFAULT_INTERVAL = 60;
/** The regions of the WCL v1 guild endpoint. */
const REGIONS = Object.freeze(["EU", "US", "KR", "TW", "CN"]);
const NAME_MAX = 64;

function str(v) {
    return v === undefined || v === null ? "" : String(v).trim();
}

function intervalOf(v) {
    const n = Number(v);
    return INTERVALS.includes(n) ? n : DEFAULT_INTERVAL;
}

function regionOf(v) {
    const r = str(v).toUpperCase();
    return REGIONS.includes(r) ? r : "EU";
}

function resultOf(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const found = Math.max(0, Math.floor(Number(v.found) || 0));
    const error = str(v.error).slice(0, 300);
    const at = Math.max(0, Number(v.at) || 0);
    return { found, error, at };
}

/** The identity of an entry: one guild per version, realm and region. */
function entryKey(entry) {
    const e = entry || {};
    return [str(e.versionId), str(e.guildName).toLowerCase(), str(e.realm).toLowerCase(), str(e.region).toUpperCase() || "EU"].join("|");
}

/**
 * A wclGuilds list in its final shape: names trimmed (an entry without guild
 * name, realm or a known version is dropped), the region one of REGIONS (EU
 * else), an unknown interval becomes DEFAULT_INTERVAL, one entry per key (the
 * first wins).
 * @param {*} raw
 */
function normalizeWclGuilds(raw) {
    const out = [];
    const seen = new Set();
    for (const src of Array.isArray(raw) ? raw : []) {
        if (!src || typeof src !== "object" || Array.isArray(src)) continue;
        const entry = {
            versionId: knownVersion(src.versionId),
            guildName: str(src.guildName).slice(0, NAME_MAX),
            realm: str(src.realm).slice(0, NAME_MAX),
            region: regionOf(src.region),
            interval: intervalOf(src.interval),
            lastRunAt: Math.max(0, Number(src.lastRunAt) || 0),
            lastSuccessAt: Math.max(0, Number(src.lastSuccessAt) || 0),
            lastResult: resultOf(src.lastResult),
        };
        if (!entry.versionId || !entry.guildName || !entry.realm) continue;
        const key = entryKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

/** The WCL guilds of one server (normalised; [] without any). */
function wclGuildsOf(guildId, { config } = {}) {
    return normalizeWclGuilds(serverSetting(guildId, "wclGuilds", { config }));
}

/**
 * Every WCL guild of every server: [{ guildId, key, ...entry }].
 * @param {{ config?: object }} [opts]
 */
function allWclGuilds({ config } = {}) {
    const cfg = config || require("../../stores/settingsStore").getConfig();
    const out = [];
    for (const guildId of Object.keys((cfg && cfg.serverSettings) || {})) {
        for (const e of wclGuildsOf(guildId, { config: cfg })) out.push({ guildId, key: entryKey(e), ...e });
    }
    return out;
}

/**
 * The list a settings PATCH sends for one server, in its final shape. The page
 * only edits version, guild, realm, region and interval: lastRunAt,
 * lastSuccessAt and lastResult come from the stored entry with the same key, never from the body.
 * @param {*} raw
 * @param {{ current?: Array }} [opts]
 */
function wclGuildsFromBody(raw, { current = [] } = {}) {
    const before = new Map(normalizeWclGuilds(current).map((e) => [entryKey(e), e]));
    const list = (Array.isArray(raw) ? raw : []).map((src) => {
        const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
        const entry = { versionId: s.versionId, guildName: s.guildName, realm: s.realm, region: s.region, interval: s.interval };
        const old = before.get(entryKey({ ...entry, region: regionOf(entry.region), versionId: knownVersion(entry.versionId) }));
        return {
            ...entry,
            lastRunAt: old ? old.lastRunAt : 0,
            lastSuccessAt: old ? old.lastSuccessAt : 0,
            lastResult: old ? old.lastResult : null,
        };
    });
    return normalizeWclGuilds(list);
}

module.exports = {
    INTERVALS,
    DEFAULT_INTERVAL,
    REGIONS,
    entryKey,
    normalizeWclGuilds,
    wclGuildsOf,
    allWclGuilds,
    wclGuildsFromBody,
};
