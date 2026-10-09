// "Mitglied hinzufügen" (#655): search the Discord members of a roster's server
// (the cached full member list, discord.fetchGuildMembersCached - a minute old
// at most) by display name, account name or a profile character's name, with
// each person's profile characters of the roster's version as the suggestion
// (the first one is preselected). Best effort: without the bot or the member
// list it answers a code ("offline", "members_unavailable") instead of an
// empty list that would read as "nobody found".
const discord = require("../discord/discord");
const raiderProfileStore = require("../../stores/raiderProfileStore");

const MAX_RESULTS = 25;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** A profile's characters of one version as the dialog shows them. */
function charsOf(userId, versionId) {
    return raiderProfileStore.charactersOfVersion(raiderProfileStore.getProfile(userId), versionId).map((c) => ({
        key: c.key,
        name: c.name,
        className: c.className,
        spec: c.specs[0] ? c.specs[0].key : "",
    }));
}

/**
 * Search the members of `guildId`.
 * @param {{ guildId: string, versionId: string, members?: object, query?: string, limit?: number }} opts
 *   `members`: the roster's members (for `inRoster`), none = nobody is in
 * @returns {Promise<{ results: { userId, displayName, inRoster, chars }[] } | { error: "offline" | "members_unavailable" }>}
 */
async function searchMembers({ guildId, versionId, members = {}, query = "", limit = MAX_RESULTS } = {}) {
    const gid = str(guildId);
    const guild = gid && discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) return { error: "offline" };
    let list;
    try {
        list = await discord.fetchGuildMembersCached(gid, guild);
    } catch {
        return { error: "members_unavailable" };
    }
    if (!Array.isArray(list) || !list.length) return { error: "members_unavailable" };
    const q = str(query).toLowerCase();
    const results = [];
    for (const m of list) {
        if (!m || !m.id || (m.user && m.user.bot)) continue;
        const userId = String(m.id);
        const displayName = str(m.displayName || (m.user && (m.user.globalName || m.user.username)) || userId);
        const chars = charsOf(userId, versionId);
        const haystack = [displayName, m.user && m.user.username, m.user && m.user.globalName, ...chars.map((c) => c.name)]
            .filter(Boolean)
            .map((s) => String(s).toLowerCase());
        if (q && !haystack.some((s) => s.includes(q))) continue;
        results.push({ userId, displayName, inRoster: !!members[userId], chars });
    }
    results.sort((a, b) => Number(a.inRoster) - Number(b.inRoster) || a.displayName.localeCompare(b.displayName));
    return { results: results.slice(0, Math.max(1, Math.min(MAX_RESULTS, Number(limit) || MAX_RESULTS))) };
}

module.exports = { searchMembers, charsOf, MAX_RESULTS };
