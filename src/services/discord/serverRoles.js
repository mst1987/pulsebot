// The roles of a Discord server as the web shows them (System › Discord › Rollen,
// web/apiRoutes/discord/discordRoles.js): read-only, nothing here changes a role.
//
// - listServerRoles(guildId)     every role of one server of the list (#895), highest first, with
//                                its members (counted), its Discord permissions (the sensitive ones
//                                apart), what it means for the bot (selfRole.roleUses + the roles of
//                                the role messages + the addon update role), whether the bot can
//                                hand it out, and hints (empty, sensitive, needed but above the bot)
// - serverRoleDetail(guildId, id) one role plus the channels with an overwrite for it (allow/deny)
//                                and its members (name, avatar; @everyone cut at 200)
//
// The member list comes from discord.fetchGuildMembersCached — the GuildMembers intent, and a
// first fetch can take a while, so it is raced against NAME_FETCH_MS: on a timeout or a failure
// the counts are null and `membersError` says why; the roles themselves always come.
// Offline (the bot not on that server or not connected): `{ online: false }` and empty lists.
const { PermissionsBitField } = require("discord.js");
const discord = require("./discord");
const { serverIds, serverLabel, roleMessageGuild } = require("./guildRoles");
const { roleUses } = require("./selfRole");
const { SENSITIVE: SENSITIVE_LIST } = require("./roleHygiene");
const { roleBelowBot } = require("./memberRoles");
const { listKnownCategories } = require("../categories/categoryNames");
const roleMessageStore = require("../../stores/roleMessageStore");
const addonCenterStore = require("../../stores/addonCenterStore");
const { getConfig } = require("../../stores/configStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

// The permissions a raid server should hand out with care ("heikel" on the page): the one list of
// roleHygiene.js, so the Discord overview and this page count the same roles.
const SENSITIVE_PERMISSIONS = SENSITIVE_LIST;
const SENSITIVE = new Set(SENSITIVE_PERMISSIONS);

// What a bot use means for handing the role out: these the bot gives members itself (sign-up,
// sync, a role message's button, the addon centre's subscribe button, a roster's member or trial
// role), so a role of one of them the bot cannot give is a problem; an admin or orga role above
// the bot is expected, a roster's manager role too (the bot never hands that out).
const HANDED_OUT = new Set(["categoryRaider", "roleSync", "roleMessage", "addonUpdates"]);
const handedOut = (use) => HANDED_OUT.has(use.code)
    || (use.code === "roster" && (use.kinds || []).some((k) => k === "member" || k === "trial"));

/** Members of @everyone the drawer gets at most; the rest only as a count (`membersTotal`). */
const EVERYONE_MEMBERS_MAX = 200;

// Old names discord.js keeps for the same bit: the newer name is the one shown.
const ALIASES = new Set(["ManageEmojisAndStickers"]);

const bitsOf = (perms) => {
    const b = perms ? perms.bitfield : undefined;
    return b === undefined || b === null ? 0n : BigInt(b);
};

/** The permission keys of a bitfield ("Administrator", "ManageRoles" …), in Discord's flag order, each bit once. */
function permissionKeys(bits) {
    const value = typeof bits === "bigint" ? bits : bitsOf(bits);
    if (value === 0n) return [];
    const seen = new Set();
    const out = [];
    for (const [key, flag] of Object.entries(PermissionsBitField.Flags)) {
        if ((value & flag) !== flag || ALIASES.has(key) || seen.has(flag)) continue;
        seen.add(flag);
        out.push(key);
    }
    return out;
}

/** Race a promise against a timer: the value, or `fallback` once `ms` have passed. */
function within(promise, ms, fallback) {
    return Promise.race([
        promise,
        new Promise((resolve) => {
            const timer = setTimeout(() => resolve(fallback), ms);
            if (timer.unref) timer.unref();
        }),
    ]);
}

const TIMED_OUT = Symbol("timed out");

/** The server's members, or `{ members: null, error }` when the list cannot be had in time. */
async function membersOf(guildId, guild, waitMs) {
    try {
        const members = await within(discord.fetchGuildMembersCached(guildId, guild), waitMs, TIMED_OUT);
        if (members === TIMED_OUT) return { members: null, error: "timeout" };
        return { members: Array.isArray(members) ? members : [], error: null };
    } catch (e) {
        return { members: null, error: str(e && e.message) || "members_unavailable" };
    }
}

/** Uses of the role beyond selfRole's: the role messages of this server and the addon update role. */
function extraUses(roleId, guildId, config) {
    const out = [];
    for (const m of orFallback(() => roleMessageStore.listMessages() || [], [])) {
        if (roleMessageGuild(m, config) !== guildId) continue;
        if ((m.roles || []).some((r) => str(r && r.roleId) === roleId)) out.push({ code: "roleMessage", messageId: str(m.id), title: str(m.title) });
    }
    const updateRole = orFallback(() => str(addonCenterStore.getSettings().roleId), "");
    if (updateRole && updateRole === roleId) out.push({ code: "addonUpdates" });
    return out;
}

/** The value of `read()`, or `fallback` when a store cannot be read (best-effort extras). */
function orFallback(read, fallback) {
    try {
        return read();
    } catch {
        return fallback;
    }
}

/** The category names for the raider-role uses, `{ [categoryId]: name }`. */
function categoryNamesFor(guildId) {
    const names = {};
    try {
        for (const c of listKnownCategories(guildId)) if (c && c.id) names[c.id] = c.name || "";
    } catch {
        // a name is a nicety; the id is shown instead
    }
    return names;
}

/** A server's name for a role use: its Discord name, else its label from the server list ("" = neither). */
function serverNameOf(guildId, config) {
    const guild = discord.getGuild(guildId);
    return (guild && str(guild.name)) || serverLabel(guildId, config) || "";
}

/** Everything the role means for the bot, with category and server names filled in. */
function usesOf(config, roleId, guildId, categoryNames) {
    const uses = roleUses(config, roleId).map((u) => {
        if (u.code === "categoryRaider") return { ...u, categories: u.categoryIds.map((id) => ({ id, name: categoryNames[id] || "" })) };
        if (u.code === "roleSync") return { ...u, servers: u.guildIds.map((id) => ({ guildId: id, name: serverNameOf(id, config) })) };
        return u;
    });
    return [...uses, ...extraUses(roleId, guildId, config)];
}

/**
 * Whether the bot can hand the role out, and if not why:
 * "everyone" | "managed" | "botRole" (its own highest role) | "noManageRoles" | "above" (at or above the bot's highest role).
 */
function assignOf(role, guild, me) {
    if (role.id === guild.id) return { ok: false, reason: "everyone" };
    if (isBotRoleOf(role, me)) return { ok: false, reason: "botRole" };
    if (role.managed) return { ok: false, reason: "managed" };
    if (!me || !me.permissions || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return { ok: false, reason: "noManageRoles" };
    return roleBelowBot(guild, role) ? { ok: true, reason: "" } : { ok: false, reason: "above" };
}

/** Whether the role is the bot's own highest role. */
function isBotRoleOf(role, me) {
    return !!(me && me.roles && me.roles.highest && me.roles.highest.id === role.id);
}

const sensitiveOf = (role) => permissionKeys(bitsOf(role.permissions)).filter((k) => SENSITIVE.has(k));

/**
 * The sensitive permissions that are the server's normal, not one role's oddity: those
 * @everyone has (every member has them anyway) and those more than half of the other roles
 * have (from three roles on). `[{ key, roles, everyone }]`, most roles first; the page names
 * them once above the table and shows them muted in the rows.
 */
function commonSensitiveOf(guild) {
    const all = [...guild.roles.cache.values()];
    const everyoneRole = all.find((r) => r.id === guild.id);
    const others = all.filter((r) => r.id !== guild.id);
    const fromEveryone = new Set(everyoneRole ? sensitiveOf(everyoneRole) : []);
    const count = new Map();
    for (const r of others) for (const k of sensitiveOf(r)) count.set(k, (count.get(k) || 0) + 1);
    const out = [];
    for (const key of SENSITIVE_PERMISSIONS) {
        const roles = count.get(key) || 0;
        const everyone = fromEveryone.has(key);
        if (everyone || (others.length >= 3 && roles * 2 > others.length)) out.push({ key, roles, everyone });
    }
    return out.sort((a, b) => b.roles - a.roles);
}

/** One role as the page reads it. */
function roleView(role, ctx) {
    const { guild, me, config, guildId, counts, categoryNames, common } = ctx;
    const everyone = role.id === guild.id;
    const isBotRole = isBotRoleOf(role, me);
    const permissions = permissionKeys(bitsOf(role.permissions));
    const sensitive = permissions.filter((k) => SENSITIVE.has(k));
    // the outliers: sensitive permissions most roles do not have, the only ones in orange
    const usual = new Set((common || []).map((c) => c.key));
    const unusual = everyone ? [] : sensitive.filter((k) => !usual.has(k));
    const uses = everyone ? [] : usesOf(config, role.id, guildId, categoryNames);
    const assign = assignOf(role, guild, me);
    const memberCount = counts ? (everyone ? counts.total : counts.byRole.get(role.id) || 0) : null;
    const hints = [];
    if (!everyone && !role.managed && memberCount === 0) hints.push("empty");
    // an integration's role (another bot) counts too; the bot's own rights are what it needs
    if (!everyone && !isBotRole && unusual.length) hints.push("sensitive");
    if (!assign.ok && assign.reason === "above" && uses.some(handedOut)) hints.push("aboveBot");
    return {
        id: role.id,
        name: everyone ? "@everyone" : str(role.name),
        color: role.color ? str(role.hexColor) : "",
        position: Number(role.position) || 0,
        managed: role.managed === true,
        everyone,
        isBotRole,
        memberCount,
        permissions,
        sensitive,
        unusual,
        uses,
        assign,
        hints,
    };
}

/** One server of the list (a guildId), its bot member and the shared context; guild null offline. */
async function contextFor(serverId, config, { waitMs }) {
    const guildId = str(serverId);
    const guild = guildId ? discord.getGuild(guildId) : null;
    if (!guild) return { guildId, guild: null };
    const me = guild.members ? guild.members.me : null;
    const { members, error } = await membersOf(guildId, guild, waitMs);
    let counts = null;
    if (members) {
        const byRole = new Map();
        for (const m of members) {
            const cache = m && m.roles && m.roles.cache;
            if (!cache || typeof cache.keys !== "function") continue;
            for (const id of cache.keys()) byRole.set(id, (byRole.get(id) || 0) + 1);
        }
        counts = { total: members.length, byRole };
    }
    return {
        guildId, guild, me, config, members, membersError: error, counts,
        // Raid categories may sit on any server: the names of every server of the list, this one's on top.
        categoryNames: Object.assign({}, ...serverIds(config).map(categoryNamesFor), categoryNamesFor(guildId)),
        common: commonSensitiveOf(guild),
    };
}

const byPosition = (a, b) => (Number(b.position) || 0) - (Number(a.position) || 0) || str(a.name).localeCompare(str(b.name));

/** The bot's highest role, `{ id, name, position }`, or null. */
function botRoleOf(me) {
    const top = me && me.roles && me.roles.highest;
    return top ? { id: str(top.id), name: str(top.name), position: Number(top.position) || 0 } : null;
}

/** The server part every answer starts with. */
function head(ctx) {
    const me = ctx.me;
    return {
        guildId: ctx.guildId,
        guildName: ctx.guild ? str(ctx.guild.name) : "",
        online: !!ctx.guild,
        botRole: ctx.guild ? botRoleOf(me) : null,
        manageRoles: ctx.guild && me && me.permissions ? me.permissions.has(PermissionsBitField.Flags.ManageRoles) : null,
        membersError: ctx.guild ? ctx.membersError : null,
    };
}

/**
 * Every role of one server, highest first, @everyone last.
 * @param {string} guildId  one of the server list (the route checks it)
 * @param {{ config?: object, waitMs?: number }} [opts]
 */
async function listServerRoles(guildId, { config = getConfig(), waitMs = discord.NAME_FETCH_MS } = {}) {
    const ctx = await contextFor(guildId, config, { waitMs });
    if (!ctx.guild) return { ...head(ctx), total: 0, roles: [], commonSensitive: [] };
    const roles = [...ctx.guild.roles.cache.values()].sort(byPosition).map((r) => roleView(r, ctx));
    return { ...head(ctx), total: roles.length, roles, commonSensitive: ctx.common };
}

/** The channel's kind for the page: "category" | "voice" | "text" (forum, news, stage count by their nearest). */
function channelKind(channel) {
    const type = Number(channel.type);
    if (type === 4) return "category";
    if (type === 2 || type === 13) return "voice";
    return "text";
}

/** The channels with an overwrite for the role, in Discord's order (categories first, then their channels). */
function overwritesFor(guild, roleId) {
    const out = [];
    const channels = guild.channels && guild.channels.cache;
    if (!channels || typeof channels.values !== "function") return out;
    for (const channel of channels.values()) {
        const cache = channel && channel.permissionOverwrites && channel.permissionOverwrites.cache;
        const own = cache && typeof cache.get === "function" ? cache.get(roleId) : null;
        if (!own) continue;
        const allow = permissionKeys(bitsOf(own.allow));
        const deny = permissionKeys(bitsOf(own.deny));
        if (!allow.length && !deny.length) continue;
        const parent = channel.parent || null;
        out.push({
            id: str(channel.id),
            name: str(channel.name),
            kind: channelKind(channel),
            parentName: parent ? str(parent.name) : "",
            sortKey: [parent ? Number(parent.rawPosition) || 0 : Number(channel.rawPosition) || 0, parent ? 1 : 0, Number(channel.rawPosition) || 0],
            allow,
            deny,
        });
    }
    out.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.sortKey[2] - b.sortKey[2] || a.name.localeCompare(b.name));
    return out.map(({ sortKey: _sortKey, ...c }) => c);
}

/**
 * One role with its channel overwrites and its members.
 * @returns {Promise<object|null>} null when the server is online but has no such role
 */
async function serverRoleDetail(guildId, roleId, { config = getConfig(), waitMs = discord.NAME_FETCH_MS } = {}) {
    const id = str(roleId);
    const ctx = await contextFor(guildId, config, { waitMs });
    if (!ctx.guild) return { ...head(ctx), total: 0, role: null, channels: [], members: [], membersTotal: 0 };
    const role = id ? ctx.guild.roles.cache.get(id) : null;
    if (!role) return null;
    const everyone = role.id === ctx.guild.id;
    const holders = ctx.members
        ? ctx.members
            .filter((m) => everyone || (m && m.roles && m.roles.cache && m.roles.cache.has(id)))
            .map((m) => ({
                id: str(m.id),
                name: str(m.displayName) || str(m.user && (m.user.globalName || m.user.username)) || str(m.id),
                avatarUrl: discord.avatarUrlOf(m),
                bot: !!(m.user && m.user.bot),
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];
    return {
        ...head(ctx),
        total: ctx.guild.roles.cache.size,
        role: roleView(role, ctx),
        channels: overwritesFor(ctx.guild, id),
        // @everyone is the whole server: a big one would make the answer heavy, so it is cut
        members: everyone ? holders.slice(0, EVERYONE_MEMBERS_MAX) : holders,
        membersTotal: holders.length,
    };
}

/** How many roles the server has (without @everyone), null offline: the tab's count. */
function roleCount(guildId) {
    const guild = guildId ? discord.getGuild(guildId) : null;
    if (!guild || !guild.roles || !guild.roles.cache) return null;
    return Math.max(0, guild.roles.cache.size - (guild.roles.cache.has(guild.id) ? 1 : 0));
}

module.exports = {
    listServerRoles, serverRoleDetail, roleCount, permissionKeys, SENSITIVE_PERMISSIONS, EVERYONE_MEMBERS_MAX,
    // shared with serverMembers.js (the member page reads the same server context)
    contextFor, head, channelKind,
};
