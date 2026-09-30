// The content switch of the menu (#563): which game versions the whole web
// admin can be switched between, what "Andere Versionen ausblenden" would
// hide, and the archive export of the other versions.
//
//   contentVersions()      { mainVersion, hideOtherVersions, versions } for the session:
//                          only versions with data or a category, the main version first
//   upcomingByVersion()    the coming raids per version, for the warning in the settings
//   archiveExport()        loot and attendance of every version but the main one
//   archiveCsv(export)     the same as one CSV file
//
// Nothing here changes data: hiding is a filter on read (mainVersion.js'
// visibleVersions), and the export only reads.
const { VERSIONS, LEGACY_VERSION } = require("../../config/gameVersions");
const { mainVersionFor, knownVersion, versionOfEvent, visibleVersions, hidesOtherVersions, otherVersions } = require("./mainVersion");
const eventStore = require("../../stores/eventStore");
const { listRaidEvents } = require("../../stores/raidEventStore");
const lootStore = require("../../stores/lootStore");
const profiles = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const { buildVersionContext, eventVersion } = require("../characters/characterVersions");

/** `{ id, label, short }` of a version for the client. */
function versionInfo(v) {
    return { id: v.id, label: v.label, short: v.short || v.label };
}

/** Every version something is stored for: events, categories, templates, characters, loot. */
function versionsWithData(config) {
    const found = new Set();
    const add = (id) => { const key = knownVersion(id); if (key) found.add(key); };
    for (const id of Object.values(config.categoryVersion || {})) add(id);
    for (const e of eventStore.listEvents("")) add(e.versionId);
    for (const e of listRaidEvents("")) add(versionOfEvent(e, { config }));
    for (const t of settingsStore.listRaidTemplates()) add(t.versionId);
    for (const p of profiles.listProfiles()) for (const c of p.characters || []) add(c.versionId || LEGACY_VERSION);
    const ctx = buildVersionContext({ config });
    for (const it of lootStore.listAll()) add(eventVersion(ctx, it.eventId));
    return found;
}

/**
 * What the menu's content switch offers: the main version first, then every
 * other version that has data or a category — none while the other versions
 * are hidden. One version only = the switch stays away.
 * @returns {{ mainVersion: string, hideOtherVersions: boolean, versions: { id, label, short }[] }}
 */
function contentVersions({ config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const mainVersion = mainVersionFor({ config: cfg });
    const hidden = hidesOtherVersions(cfg);
    const visible = new Set(visibleVersions(cfg));
    const withData = hidden ? new Set() : versionsWithData(cfg);
    const main = VERSIONS.find((v) => v.id === mainVersion);
    const rest = VERSIONS.filter((v) => v.id !== mainVersion && visible.has(v.id) && withData.has(v.id));
    return { mainVersion, hideOtherVersions: hidden, versions: [main, ...rest].filter(Boolean).map(versionInfo) };
}

/**
 * The raids still to come, per version (the settings' warning before hiding):
 * own events that are not cancelled, and the Raid-Helper events the scan has
 * seen (a coming Raid-Helper raid the scan never saw is not known here).
 * @returns {Record<string, { id: string, title: string, startTime: number }[]>} soonest first
 */
function upcomingByVersion({ config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const nowSec = Math.floor(now / 1000);
    const out = {};
    const seen = new Set();
    const push = (e) => {
        if (!e || !e.id || seen.has(e.id) || !(Number(e.startTime) >= nowSec)) return;
        seen.add(e.id);
        const versionId = versionOfEvent(e, { config: cfg });
        (out[versionId] = out[versionId] || []).push({ id: e.id, title: e.title || "", startTime: Number(e.startTime) });
    };
    for (const e of eventStore.listEvents("")) if (e.status !== "cancelled") push(e);
    for (const e of listRaidEvents("")) push(e);
    for (const list of Object.values(out)) list.sort((a, b) => a.startTime - b.startTime);
    return out;
}

/** The date of a unix time (seconds or ms) as YYYY-MM-DD, "" without one. */
function isoDay(t) {
    const n = Number(t) || 0;
    if (!n) return "";
    return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10);
}

/** The attendance rows of one stored event: one per signup (Raid-Helper and own shapes). */
function attendanceRows(e, versionId) {
    const rows = [];
    for (const s of e.signUps || []) {
        rows.push({
            versionId, eventId: e.id, date: isoDay(e.startTime), raid: e.title || "",
            category: e.categoryName || "", character: s.character || s.name || "",
            className: s.className || "", spec: s.specName || s.spec || "", status: s.status || "",
        });
    }
    return rows;
}

/**
 * Loot and attendance of every version but the main one (#563) — the archive
 * an orga keeps before hiding them. Read only; nothing is removed.
 */
function archiveExport({ config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    // Only the versions something is stored for: an empty Classic has nothing to archive.
    const withData = versionsWithData(cfg);
    const versions = otherVersions(cfg).filter((id) => withData.has(id));
    const wanted = new Set(versions);
    const ctx = buildVersionContext({ config: cfg });
    const loot = lootStore.listAll()
        .map((it) => ({ it, versionId: eventVersion(ctx, it.eventId) }))
        .filter((x) => wanted.has(x.versionId))
        .map(({ it, versionId }) => ({
            versionId, eventId: it.eventId || "", date: isoDay(it.awardedAt || it.importedAt), raid: it.eventLabel || it.instance || "",
            character: it.character || "", itemId: it.itemId || "", item: it.itemName || "", reason: it.reasonLabel || it.response || "",
        }));
    const { listStoredEvents } = require("./eventSources");
    const attendance = listStoredEvents("", { now })
        .map((e) => ({ e, versionId: versionOfEvent(e, { config: cfg }) }))
        .filter((x) => wanted.has(x.versionId))
        .flatMap(({ e, versionId }) => attendanceRows(e, versionId));
    return { exportedAt: new Date(now).toISOString(), mainVersion: mainVersionFor({ config: cfg }), versions, loot, attendance };
}

const CSV_COLUMNS = ["type", "versionId", "date", "raid", "eventId", "character", "item", "itemId", "reason", "category", "className", "spec", "status"];

/** One CSV field: quoted when it holds a separator, a quote or a line break; a leading formula sign is defused. */
function csvField(value) {
    let s = String(value === null || value === undefined ? "" : value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

/** archiveExport() as one CSV: a `type` column says loot or attendance. */
function archiveCsv(data) {
    const lines = [CSV_COLUMNS.join(",")];
    for (const row of data.loot) lines.push(CSV_COLUMNS.map((c) => csvField(c === "type" ? "loot" : row[c])).join(","));
    for (const row of data.attendance) lines.push(CSV_COLUMNS.map((c) => csvField(c === "type" ? "attendance" : row[c])).join(","));
    return `${lines.join("\r\n")}\r\n`;
}

module.exports = { contentVersions, upcomingByVersion, archiveExport, archiveCsv, versionsWithData };
