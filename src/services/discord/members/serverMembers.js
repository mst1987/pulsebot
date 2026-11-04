// Who is a member of one Discord server, for a route that limits a holder of only
// the server-admin rank (#1072) to the people of their own server. The lookup behind
// it can take long on a big server (a full member fetch), so waiting for it is
// bounded here; a slow answer still lands in the shared member cache for the next call.
const discord = require("../discord");

const DEFAULT_WAIT_MS = 5000;

/**
 * The user ids of the members of `guildId`, or null when that cannot be shown right now
 * (no server, the lookup failed or took too long). A caller limiting access treats null
 * as "nobody": without proof nobody counts as a member.
 * @returns {Promise<Set<string>|null>}
 */
async function serverMemberIds(guildId, { waitMs = DEFAULT_WAIT_MS } = {}) {
    const gid = String(guildId || "").trim();
    if (!gid) return null;
    let timer;
    const tooLate = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), waitMs);
        if (timer.unref) timer.unref();
    });
    try {
        const listed = await Promise.race([discord.listHumanMembers(gid), tooLate]);
        if (!listed || listed.error || !Array.isArray(listed.members)) return null;
        return new Set(listed.members.map((m) => String(m.id)));
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { serverMemberIds };
