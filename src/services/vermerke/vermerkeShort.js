// The short form of the Vermerke (docs/vermerke.md, #979): what every orga that
// plans a raid sees next to a name - the highest active level and the reasons
// with how often they occur, nothing more. Never the text, never who wrote it,
// never the raids. The full entries are behind the area "vermerke" (read).
//
// This is the one door for code outside the Vermerke routes (the setup proposal,
// the raid detail, #981): it alone reads stores/userNotesStore.js. Whatever goes
// out of here goes to the orga only - never into an answer a raider gets
// (test/services/vermerke/vermerkeNeverToPerson.test.js).
const notes = require("../../stores/userNotesStore");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The highest active level of `userId` on `guildId` (own and shared entries, not hidden), null when none. */
function activeLevelFor(guildId, userId, opts = {}) {
    return notes.activeLevelFor(guildId, userId, opts);
}

/** The short form of one person: `{ level, reasons: { [reason]: count } }`, null when no entry counts. */
function shortOf(guildId, userId, { now = Date.now() } = {}) {
    return summarize(notes.activeEntries(guildId, userId, { now }));
}

/** Level and reason counts of counting entries, null when there are none. */
function summarize(entries) {
    if (!entries.length) return null;
    let level = null;
    const reasons = {};
    for (const e of entries) {
        if (level === null || notes.levelRank(e.level) > notes.levelRank(level)) level = e.level;
        reasons[e.reason] = (reasons[e.reason] || 0) + 1;
    }
    return { level, reasons };
}

/**
 * The short form of every person of `userIds` on `guildId` that has an active entry:
 * `{ [userId]: { level, reasons } }` - persons without one are not listed. Reads the store once,
 * however many persons are asked (a raid with 40 signups is one read).
 */
function shortFor(guildId, userIds, { now = Date.now() } = {}) {
    const ids = (Array.isArray(userIds) ? userIds : []).map(str).filter(Boolean);
    const out = {};
    for (const [uid, entries] of Object.entries(notes.activeEntriesMany(guildId, ids, { now }))) {
        out[uid] = summarize(entries);
    }
    return out;
}

/**
 * The persons of `userIds` with an active shadowban on `guildId` (own or shared, not hidden, not
 * expired) - the setup proposal never places them by itself (#981). Warnings and hints do not count.
 */
function shadowbannedAmong(guildId, userIds, { now = Date.now() } = {}) {
    return Object.entries(shortFor(guildId, userIds, { now }))
        .filter(([, short]) => short && short.level === "shadowban")
        .map(([uid]) => uid);
}

module.exports = { activeLevelFor, shortOf, shortFor, shadowbannedAmong, levelRank: notes.levelRank };
