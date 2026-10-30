// Which raids an absence or attendance entry (availabilityStore) covers - the one
// rule every reader shares: the entry service (availability.js), the orga's
// overview (absenceOverview.js), the attendance's "Urlaub" (rosterAttendance.js)
// and the Discord list.
//
//   * the day: the raid's day (server time) lies in the entry's period;
//   * the scope, per server: `scope: [{ guildId, categoryIds }]` - the raid's
//     server is one of the entry's, and there `categoryIds` is empty (every
//     category of that server) or holds the raid's category. A raid of another
//     server is never covered.
//   * older entries without `scope`: `categoryId` set = that category (on any
//     server - a category id is one channel, so on one server anyway), "" = every
//     raid, as before;
//   * an attendance covers a raid only when it has a character of the raid's game
//     version (versionOfEvent - the version hangs on the raid). A character without
//     a version (very old entries) counts for every version.
//
// No store writes, no Discord. The server of a raid is its `guildId`, else the
// first server (an own event without one predates the server list).
const { DateTime } = require("luxon");
const settingsStore = require("../../stores/settings/settingsStore");
const { TIMEZONE } = require("../../config/timezone");
const { versionOfEvent } = require("../versions/mainVersion");
const { firstServerId } = require("../discord/servers/serverOf");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** "yyyy-MM-dd" of a moment in server time. */
function dayOf(seconds) {
    return DateTime.fromSeconds(Number(seconds) || 0, { zone: TIMEZONE }).toFormat("yyyy-MM-dd");
}

/** The server a raid belongs to: its own, else the first server of the list (the settings' when no config is handed in). */
function eventServer(event, config) {
    return str(event && event.guildId) || firstServerId(config || settingsStore.getConfig());
}

/**
 * An entry's scope as a list `[{ guildId, categoryIds }]`; `guildId` "" = any
 * server (an older entry limited to one category). null = every raid (an older
 * entry without category).
 */
function scopeOf(entry) {
    const list = Array.isArray(entry && entry.scope) ? entry.scope.filter((s) => s && (str(s.guildId) || (Array.isArray(s.categoryIds) && s.categoryIds.length))) : [];
    if (list.length) return list.map((s) => ({ guildId: str(s.guildId), categoryIds: (Array.isArray(s.categoryIds) ? s.categoryIds : []).map(str).filter(Boolean) }));
    const cat = str(entry && entry.categoryId);
    return cat ? [{ guildId: "", categoryIds: [cat] }] : null;
}

/** Whether a raid's server and category lie in the entry's scope (not its day, not its version). */
function scopeCovers(entry, event, { config } = {}) {
    const scope = scopeOf(entry);
    if (!scope) return true;
    const cat = str(event && event.categoryId);
    let server = null;
    return scope.some((s) => {
        if (s.guildId) {
            if (server === null) server = eventServer(event, config);
            if (s.guildId !== server) return false;
        }
        return !s.categoryIds.length || s.categoryIds.includes(cat);
    });
}

/** An attendance's characters `[{ character, spec, versionId }]`; an older entry's single one as a list. */
function charactersOf(entry) {
    const list = Array.isArray(entry && entry.characters) ? entry.characters.filter((c) => c && str(c.character)) : [];
    if (list.length) return list.map((c) => ({ character: str(c.character), spec: str(c.spec), versionId: str(c.versionId) }));
    return entry && str(entry.character) ? [{ character: str(entry.character), spec: str(entry.spec), versionId: str(entry.versionId) }] : [];
}

/**
 * The characters an attendance signs a raid up with: those of the raid's version,
 * in the entry's order, at most `max` (the raid's maxCharactersFor - the rest is
 * left out instead of the raid failing).
 */
function charactersFor(entry, event, { max = Infinity, config } = {}) {
    const version = versionOfEvent(event, { config });
    const fit = charactersOf(entry).filter((c) => !c.versionId || c.versionId === version);
    return fit.slice(0, Math.max(0, Number(max) || 0) || fit.length);
}

/** Whether a raid lies in an entry's period and scope (not whether it can still be changed). */
function covers(entry, event, { config } = {}) {
    if (!entry || !event || !event.startTime) return false;
    const day = dayOf(event.startTime);
    if (day < entry.from || day > entry.to) return false;
    if (!scopeCovers(entry, event, { config })) return false;
    if (entry.kind === "presence" && !charactersFor(entry, event, { config }).length) return false;
    return true;
}

module.exports = { covers, scopeOf, scopeCovers, charactersOf, charactersFor, eventServer, dayOf };
