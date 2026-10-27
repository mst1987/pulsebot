// The members of a Discord server as the web shows them (System › Discord › Mitglieder,
// web/apiRoutes/discordMembers.js): read-only, nothing here changes a member.
//
// - listServerMembers(guildId)       every member of one server of the list (#895): name, user
//                                    name, avatar, bot, joined, role ids (highest first), the
//                                    rosters and characters (memberRelation.js) and hints; the
//                                    server's roles once (name, colour) for the role column
// - serverMemberDetail(guildId, id)  one member plus the channels it can see (ViewChannel),
//                                    grouped by category: text, voice and forum only
//
// The member list is discord.fetchGuildMembersCached, raced against NAME_FETCH_MS like the role
// page (serverRoles.contextFor): never a fetch per page view beyond the cache, the server has one
// vCPU. On a timeout or a failure `membersError` says why and the list is empty.
// Offline (the bot not on that server or not connected): `{ online: false }` and empty lists.
const { PermissionsBitField } = require("discord.js");
const discord = require("./discord");
const serverRoles = require("./serverRoles");
const memberRelation = require("./memberRelation");
const { getConfig } = require("../../stores/configStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The roles of the server without @everyone, highest first: `{ id, name, color, position }`. */
function rolesOf(guild) {
    return [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => (Number(b.position) || 0) - (Number(a.position) || 0) || str(a.name).localeCompare(str(b.name)))
        .map((r) => ({ id: str(r.id), name: str(r.name), color: r.color ? str(r.hexColor) : "", position: Number(r.position) || 0 }));
}

/** The member's role ids (without @everyone), in the order of `order` (highest first). */
function roleIdsOf(member, guildId, order) {
    const cache = member && member.roles && member.roles.cache;
    if (!cache || typeof cache.keys !== "function") return [];
    const own = new Set([...cache.keys()].map(str).filter((id) => id && id !== guildId));
    return order.filter((id) => own.has(id));
}

/**
 * The hints of one member: the rosters whose member or trial role it holds without being in
 * that roster ("hat die Raider-Rolle, steht aber nicht im Roster").
 */
function missingRostersOf(roleIds, relation, rosters) {
    const held = new Set(roleIds);
    const inRoster = new Set(relation.rosters.map((r) => r.id));
    return rosters
        .filter((r) => !inRoster.has(r.id) && [...(r.roleIds || []), r.trialRoleId].some((id) => id && held.has(id)))
        .map((r) => ({ id: r.id, name: r.name }));
}

const joinedOf = (m) => {
    const t = Number(m && m.joinedTimestamp);
    return Number.isFinite(t) && t > 0 ? t : null;
};

/** One member as the page reads it. */
function memberView(m, { guildId, order, relations, rosters }) {
    const id = str(m.id);
    const user = m.user || {};
    const roleIds = roleIdsOf(m, guildId, order);
    const bot = !!user.bot;
    const relation = bot ? { rosters: [], characters: [] } : relations.of(id);
    return {
        id,
        name: str(m.displayName) || str(user.globalName || user.username) || id,
        username: str(user.username),
        avatarUrl: discord.avatarUrlOf(m),
        bot,
        joinedAt: joinedOf(m),
        roleIds,
        rosters: relation.rosters,
        characters: relation.characters,
        missingRosters: bot ? [] : missingRostersOf(roleIds, relation, rosters),
    };
}

/** What every member view needs, read once per answer. */
function viewContext(ctx) {
    const roles = rolesOf(ctx.guild);
    const relations = memberRelation.relationIndex();
    return { roles, guildId: str(ctx.guild.id), order: roles.map((r) => r.id), relations, rosters: relations.rosters };
}

/**
 * Every member of one server, by name.
 * @param {string} guildId  one of the server list (the route checks it)
 * @param {{ config?: object, waitMs?: number }} [opts]
 */
async function listServerMembers(guildId, { config = getConfig(), waitMs = discord.NAME_FETCH_MS } = {}) {
    const ctx = await serverRoles.contextFor(guildId, config, { waitMs });
    if (!ctx.guild) return { ...serverRoles.head(ctx), total: 0, roles: [], members: [] };
    const view = viewContext(ctx);
    const members = (ctx.members || [])
        .filter((m) => m && m.id)
        .map((m) => memberView(m, view))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { ...serverRoles.head(ctx), total: members.length, roles: view.roles, members };
}

// The channel types the drawer lists: text 0, announcement 5, voice 2, stage 13, forum 15, media 16.
const KIND_OF_TYPE = { 0: "text", 5: "text", 2: "voice", 13: "voice", 15: "forum", 16: "forum" };

/**
 * The channels the member can see, grouped by category in Discord's order:
 * `[{ id, name, visible, total, channels: [{ id, name, kind }] }]`; channels without a category
 * come first under id "" (as in Discord). `total` counts every listed channel of the category,
 * `visible` the ones the member sees; a category the member sees nothing of stays in with 0.
 */
function visibleChannels(guild, member) {
    const cache = guild.channels && guild.channels.cache;
    if (!cache || typeof cache.values !== "function") return [];
    const all = [...cache.values()];
    const groups = new Map();
    const groupFor = (parent) => {
        const key = parent ? str(parent.id) : "";
        if (!groups.has(key)) {
            groups.set(key, { id: key, name: parent ? str(parent.name) : "", position: parent ? Number(parent.rawPosition) || 0 : -1, visible: 0, total: 0, channels: [] });
        }
        return groups.get(key);
    };
    const view = PermissionsBitField.Flags.ViewChannel;
    const listed = all
        .filter((c) => c && KIND_OF_TYPE[Number(c.type)])
        .sort((a, b) => (Number(a.rawPosition) || 0) - (Number(b.rawPosition) || 0) || str(a.name).localeCompare(str(b.name)));
    for (const channel of listed) {
        const group = groupFor(channel.parent || null);
        group.total += 1;
        let sees;
        try {
            const perms = typeof channel.permissionsFor === "function" ? channel.permissionsFor(member) : null;
            sees = !!perms && perms.has(view);
        } catch {
            sees = false;
        }
        if (!sees) continue;
        group.visible += 1;
        group.channels.push({ id: str(channel.id), name: str(channel.name), kind: KIND_OF_TYPE[Number(channel.type)] });
    }
    return [...groups.values()]
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map(({ position: _position, ...g }) => g);
}

/**
 * One member with its roles, rosters, characters and the channels it can see.
 * When the server is online but has no such member the answer carries `gone: true` and
 * `member: null`.
 * @returns {Promise<object>}
 */
async function serverMemberDetail(guildId, userId, { config = getConfig(), waitMs = discord.NAME_FETCH_MS } = {}) {
    const id = str(userId);
    const ctx = await serverRoles.contextFor(guildId, config, { waitMs });
    if (!ctx.guild) return { ...serverRoles.head(ctx), member: null, roles: [], channels: [] };
    const fromList = (ctx.members || []).find((m) => m && str(m.id) === id);
    const cache = ctx.guild.members && ctx.guild.members.cache;
    const member = fromList || (id && cache && typeof cache.get === "function" ? cache.get(id) : null);
    // gone: the server is online but has no such member (left, or a stale link)
    if (!member) return { ...serverRoles.head(ctx), gone: true, member: null, roles: [], channels: [] };
    const roles = rolesOf(ctx.guild);
    const rosters = memberRelation.openRosters();
    // one account: its relation alone, not the index of the whole server
    const relations = { of: (uid) => memberRelation.relationOf(uid, { rosters }) };
    const shown = memberView(member, { roles, guildId: str(ctx.guild.id), order: roles.map((r) => r.id), relations, rosters });
    const byId = new Map(roles.map((r) => [r.id, r]));
    return {
        ...serverRoles.head(ctx),
        member: shown,
        roles: shown.roleIds.map((rid) => byId.get(rid)).filter(Boolean),
        channels: visibleChannels(ctx.guild, member),
    };
}

/**
 * How many people the server has (bots left out, as on the list), null offline: the
 * tab's count. With the whole member cache the people are counted there; with a partial cache
 * (no GuildMembers intent) Discord's own count minus the bots the cache knows.
 */
function memberCount(guildId) {
    const guild = guildId ? discord.getGuild(guildId) : null;
    if (!guild) return null;
    const n = Number(guild.memberCount);
    const cache = guild.members && guild.members.cache;
    const cached = cache && typeof cache.values === "function" ? [...cache.values()].filter(Boolean) : [];
    const bots = cached.filter((m) => m.user && m.user.bot).length;
    if (!Number.isFinite(n) || n < 0) return cached.length ? cached.length - bots : null;
    if (cached.length >= n) return cached.length - bots;
    return Math.max(0, n - bots);
}

module.exports = { listServerMembers, serverMemberDetail, memberCount, visibleChannels };
