// The Kanäle page's own memory (issue #259): which category is the archive per
// server, the naming schema per category, after how many days an archived
// channel is flagged, and the archive log — who archived which channel when.
//
// Kept out of the general bot config on purpose: all of it belongs to the
// "channels" area, so whoever may manage channels can set it from the Kanäle
// page without write access to Einstellungen.
//
// Archiving never deletes anything, and nothing here ever does either: the log
// only feeds the hint "n archivierte Kanäle warten auf Löschung" (Kanäle page and
// the dashboard's open tasks). Deleting stays a person's decision.

const fs = require("fs");
const path = require("path");

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const ARCHIVE_FILE = path.join(SETTINGS_DIR, "channel-archive.json");

/** Days an archived channel may wait before the hint turns yellow. */
const DEFAULT_HINT_DAYS = 14;
const DAY_MS = 86400000;

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf8"));
        return {
            guilds: data && typeof data.guilds === "object" && !Array.isArray(data.guilds) ? data.guilds : {},
            entries: data && typeof data.entries === "object" && !Array.isArray(data.entries) ? data.entries : {},
            archiveDeleteHintDays: data && Number.isFinite(data.archiveDeleteHintDays) ? data.archiveDeleteHintDays : DEFAULT_HINT_DAYS,
        };
    } catch {
        return { guilds: {}, entries: {}, archiveDeleteHintDays: DEFAULT_HINT_DAYS };
    }
}

function writeAll(data) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(data, null, 2));
}

const clean = (v) => String(v || "").trim();

/** Clamp the hint deadline to 1..365 days; anything unreadable falls back to 14. */
function normalizeHintDays(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return DEFAULT_HINT_DAYS;
    return Math.min(365, n);
}

/** One server's channel settings: `{ archiveCategoryId, schemas, archiveDeleteHintDays }`. */
function getChannelConfig(guildId) {
    const all = readAll();
    const own = all.guilds[clean(guildId)] || {};
    return {
        archiveCategoryId: clean(own.archiveCategoryId),
        schemas: own.schemas && typeof own.schemas === "object" ? own.schemas : {},
        archiveDeleteHintDays: normalizeHintDays(all.archiveDeleteHintDays),
    };
}

/** Store the archive category (per server) and/or the hint deadline (for all servers). */
function saveChannelConfig(guildId, { archiveCategoryId, archiveDeleteHintDays } = {}) {
    const all = readAll();
    const id = clean(guildId);
    if (archiveCategoryId !== undefined && id) {
        all.guilds[id] = { ...(all.guilds[id] || {}), archiveCategoryId: clean(archiveCategoryId) };
    }
    if (archiveDeleteHintDays !== undefined) all.archiveDeleteHintDays = normalizeHintDays(archiveDeleteHintDays);
    writeAll(all);
    return getChannelConfig(id);
}

/**
 * Remember the naming schema a category's quick-create starts with. `time` is
 * the start time of the events "gleich Event anlegen" creates ("19:30"); left
 * out, the stored one stays.
 */
function saveCategorySchema(guildId, categoryId, { schema = "", raid = "", templateChannelId = "", time } = {}) {
    const id = clean(guildId);
    const cat = clean(categoryId);
    if (!id || !cat) return null;
    const all = readAll();
    const guild = all.guilds[id] || {};
    const schemas = { ...(guild.schemas || {}) };
    const previous = schemas[cat] || {};
    const eventTime = time === undefined ? clean(previous.time) : clean(time);
    schemas[cat] = { schema: clean(schema), raid: clean(raid), templateChannelId: clean(templateChannelId), ...(eventTime ? { time: eventTime } : {}) };
    all.guilds[id] = { ...guild, schemas };
    writeAll(all);
    return schemas[cat];
}

/** Log an archived channel. Archiving it again refreshes the entry. */
function recordArchived({ channelId, guildId, name = "", fromParentId = "", fromCategory = "", by = "", byName = "", at = Date.now() } = {}) {
    const id = clean(channelId);
    if (!id) return null;
    const all = readAll();
    all.entries[id] = {
        channelId: id, guildId: clean(guildId), name: clean(name), fromParentId: clean(fromParentId),
        fromCategory: clean(fromCategory), by: clean(by), byName: clean(byName), at: Number(at) || Date.now(),
    };
    writeAll(all);
    return all.entries[id];
}

/** The log of one server, oldest first. */
function listArchived(guildId) {
    const id = clean(guildId);
    return Object.values(readAll().entries)
        .filter((e) => e && (!id || e.guildId === id))
        .sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** Drop channels from the log (deleted, or taken back out of the archive). */
function forgetArchived(channelIds = []) {
    const all = readAll();
    let removed = 0;
    for (const id of channelIds) {
        if (all.entries[clean(id)]) {
            delete all.entries[clean(id)];
            removed++;
        }
    }
    if (removed) writeAll(all);
    return removed;
}

/**
 * The channels that wait in the archive, and how many of them longer than the
 * deadline. Pure: `archived` is the live list of channels in the archive
 * category (`{ id, name }`), `entries` the log. A channel somebody moved into
 * the archive by hand has no entry and counts as waiting since an unknown time
 * — it waits, but it is never "overdue", because nobody knows since when.
 */
function archiveHint({ archived = [], entries = [], hintDays = DEFAULT_HINT_DAYS, now = Date.now() } = {}) {
    const byId = new Map((entries || []).map((e) => [e.channelId, e]));
    const days = normalizeHintDays(hintDays);
    const rows = (archived || []).map((c) => {
        const entry = byId.get(c.id) || null;
        const waitingDays = entry ? Math.floor((now - entry.at) / DAY_MS) : null;
        return {
            id: c.id,
            name: c.name,
            at: entry ? entry.at : 0,
            by: entry ? entry.byName || entry.by : "",
            fromCategory: entry ? entry.fromCategory : "",
            waitingDays,
            overdue: waitingDays !== null && waitingDays >= days,
        };
    });
    return { count: rows.length, overdue: rows.filter((r) => r.overdue).length, hintDays: days, rows };
}

/** Drop everything — tests only. */
function reset() {
    try {
        fs.unlinkSync(ARCHIVE_FILE);
    } catch {
        // never existed
    }
}

module.exports = {
    DEFAULT_HINT_DAYS, ARCHIVE_FILE,
    getChannelConfig, saveChannelConfig, saveCategorySchema, normalizeHintDays,
    recordArchived, listArchived, forgetArchived, archiveHint, reset,
};
