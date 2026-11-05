// A member's Discord roles for the raider's lists of raids ("Für dich", the
// "Anmeldungen" page), with a short memory.
//
// The lists show only the raids a member may sign up for (signups/signupAccess.js),
// and for a category with raider roles that needs the member's roles. Reading
// them can fail for a moment — the bot reconnecting, a slow member fetch — and
// a list that then hid every raid with roles would be a real loss. So the last
// roles read for a member are kept for KEEP_MS and stand in when a read fails;
// only without them the roles are unknown (`roleIds: null`) and the caller
// says so. A member who left the server reads as unknown once the memory ends.
// A caller that must tell "surely no member" from "unknown" passes `absentAs`;
// that answer is for this one call and never enters the memory, or the lists
// would read an outage as "holds no role" instead of "unknown".
//
// discord.memberRoleIds itself stays uncached: the save (checkRaiderRole) reads
// the live roles.
const discord = require("../discord");

const KEEP_MS = 15 * 60 * 1000;
const cache = new Map(); // `${guildId}:${userId}` -> { ids, at }

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Drop what is past its time, so the memory never grows with old members. */
function prune(now) {
    for (const [key, hit] of cache) if (now - hit.at >= KEEP_MS) cache.delete(key);
}

/**
 * The member's roles on a server: read live, else the last read of the past
 * KEEP_MS (`stale: true`), else unknown (`roleIds: null`).
 * @param {string} guildId
 * @param {string} userId
 * @param {{ now?: number, waitMs?: number, absentAs?: string[] }} [opts] `waitMs`, `absentAs`:
 *   see discord.memberRoleIds; the array handed in comes back as is, and only that tells it from
 *   a member who really holds no role
 * @returns {Promise<{ roleIds: string[]|null, stale: boolean }>}
 */
async function memberRolesRemembered(guildId, userId, { now = Date.now(), waitMs, absentAs } = {}) {
    const gid = str(guildId);
    const uid = str(userId);
    const key = `${gid}:${uid}`;
    const opts = { ...(absentAs && { absentAs }), ...(waitMs !== undefined && { waitMs }) };
    let ids = null;
    if (gid && uid) {
        try {
            ids = await (Object.keys(opts).length ? discord.memberRoleIds(gid, uid, opts) : discord.memberRoleIds(gid, uid));
        } catch {
            ids = null;
        }
    }
    if (ids && ids === absentAs) return { roleIds: ids.slice(), stale: false };
    if (Array.isArray(ids)) {
        prune(now);
        const roleIds = ids.map(String);
        cache.set(key, { ids: roleIds, at: now });
        return { roleIds: roleIds.slice(), stale: false };
    }
    const hit = cache.get(key);
    if (hit && now - hit.at < KEEP_MS) return { roleIds: hit.ids.slice(), stale: true };
    return { roleIds: null, stale: false };
}

/** Only for the tests: forget every member. */
function _resetForTests() {
    cache.clear();
}

module.exports = { memberRolesRemembered, KEEP_MS, _resetForTests };
