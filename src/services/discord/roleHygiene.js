// Role hygiene of one server, as counts for the Discord overview
// (docs/discord-servers.md "Discord-Übersicht"): roles nobody holds, roles
// above the bot's own, roles with rights that can harm the server.
//
// Cache only — never a member fetch (that hangs without the GuildMembers
// intent and costs on 1 vCPU). "Empty" therefore needs the whole member list in
// the cache; while it is not, the count is null (unknown), not a guess.
const { PermissionsBitField } = require("discord.js");
const discord = require("./discord");

/** Rights that let a role change or harm the server. */
const SENSITIVE = [
    "Administrator", "ManageGuild", "ManageRoles", "ManageChannels",
    "BanMembers", "KickMembers", "MentionEveryone", "ManageWebhooks",
];

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** Whether the member cache holds every member of the guild. */
function membersComplete(guild) {
    const cache = guild.members && guild.members.cache;
    const total = Number(guild.memberCount);
    return !!cache && Number.isFinite(total) && total > 0 && cache.size >= total;
}

function holders(role, guild) {
    if (role.members && typeof role.members.size === "number") return role.members.size;
    let n = 0;
    for (const m of guild.members.cache.values()) if (m.roles && m.roles.cache && m.roles.cache.has(role.id)) n += 1;
    return n;
}

/**
 * `{ known, total, empty, aboveBot, sensitive }` of one server. @everyone and
 * integration roles (bots, boosts) are left out. `known` false = bot offline or
 * not on the server, every count null. `empty` null = member cache incomplete.
 */
function roleHygiene(guildId) {
    const gid = str(guildId);
    const guild = gid && discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild || !guild.roles || !guild.roles.cache) return { known: false, total: null, empty: null, aboveBot: null, sensitive: null };
    const roles = [...guild.roles.cache.values()].filter((r) => r && r.id !== gid && !r.managed);
    const me = guild.members ? guild.members.me : null;
    const top = me && me.roles && me.roles.highest ? Number(me.roles.highest.position) : null;
    const flags = SENSITIVE.map((k) => PermissionsBitField.Flags[k]);
    const complete = membersComplete(guild);
    return {
        known: true,
        total: roles.length,
        empty: complete ? roles.filter((r) => holders(r, guild) === 0).length : null,
        aboveBot: top === null ? null : roles.filter((r) => Number(r.position) > top).length,
        sensitive: roles.filter((r) => r.permissions && flags.some((f) => r.permissions.has(f))).length,
    };
}

module.exports = { roleHygiene, SENSITIVE };
