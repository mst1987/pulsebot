// The history of a roster (GET /api/rosters/history, the "Verlauf" tab and the
// member drawer, #655): the store's lines (rosterStore `history`, the newest
// 500, oldest first) newest first, a page at a time, optionally only the lines
// about one person. Each line carries the names of who did it (`byName`) and of
// whom it is about (`userName`) - the cached Discord member list, else the
// raider profile, else the id; an empty `by` is the bot or the start-up
// migration. `what` and `detail` stay as stored: the client translates the
// codes ("member-added", "role-give-failed", "status core → bench", ...).
const profiles = require("../../stores/raiderProfileStore");
const discord = require("../../services/discord/discord");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** A name resolver over the server's cached member list (best-effort) and the profiles. */
async function namerFor(guildId) {
    const byId = new Map();
    if (guildId) {
        try {
            const listed = await discord.listHumanMembers(guildId);
            for (const m of (listed && !listed.error && listed.members) || []) byId.set(String(m.id), str(m.displayName));
        } catch {
            // names fall back to the profiles
        }
    }
    return (userId) => {
        const id = str(userId);
        if (!id) return "";
        if (byId.get(id)) return byId.get(id);
        const p = profiles.getProfile(id);
        return str(p && p.name) || id;
    };
}

/** A whole number in [min, max], else `fallback`. */
function bounded(raw, fallback, min, max) {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && raw !== "" && raw !== null && raw !== undefined ? Math.max(min, Math.min(max, n)) : fallback;
}

/**
 * One page of a roster's history, newest first.
 * @param {object} roster the stored roster
 * @param {{ userId?: string, offset?: number|string, limit?: number|string }} [opts]
 * @returns {Promise<{ entries: { at, by, byName, userId, userName, what, detail }[], total: number, offset: number, limit: number }>}
 */
async function buildRosterHistory(roster, { userId = "", offset = 0, limit = DEFAULT_LIMIT } = {}) {
    const uid = str(userId);
    const all = (roster.history || []).filter((h) => !uid || h.userId === uid).slice().reverse();
    const from = bounded(offset, 0, 0, all.length);
    const size = bounded(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const page = all.slice(from, from + size);
    const nameOf = await namerFor(roster.guildId);
    return {
        entries: page.map((h) => ({
            at: h.at,
            by: h.by,
            byName: nameOf(h.by),
            userId: h.userId,
            userName: nameOf(h.userId),
            what: h.what,
            detail: h.detail,
        })),
        total: all.length,
        offset: from,
        limit: size,
    };
}

module.exports = { buildRosterHistory, DEFAULT_LIMIT, MAX_LIMIT };
