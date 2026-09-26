// Who may run a bot command — checked once in bot.js before any handler runs.
//
// The rules live in config/botCommands.js; this module resolves them:
//   admin (ADMIN_USER_ID / LOGCHECK_ADMIN_IDS, the admin roles from Zugang)
//     → the setting stored in config.botCommandAccess
//     → the command's own `defaultAccess`
//     → admin-only (fail-closed).
// Buttons, selects and modals name their command with `accessOf` and are judged
// by that command's rule.
//
// Roles are always resolved against the *event* guild, whichever server the
// interaction came from — members are on both.
const { MessageFlags } = require("discord.js");
const { getConfig } = require("../stores/settingsStore");
const discord = require("./discord");
const { logcheckAdminIds, adminRoleIds: envAdminRoleIds } = require("../config/variables");
const { eventGuildId } = require("./guildRoles");
const { normalizeRule, normalizeBotCommandAccess } = require("../config/botCommands");

// accessOf chains are one link deep in practice; the cap only guards a loop.
const MAX_ACCESS_OF_DEPTH = 5;

/** A Collection, Map, array or plain object of command modules as a name → module lookup. */
function commandLookup(commands) {
    if (!commands) return () => null;
    if (typeof commands.get === "function") return (name) => commands.get(name) || null;
    if (Array.isArray(commands)) {
        const byName = new Map(commands.filter(Boolean).map((c) => [c.name, c]));
        return (name) => byName.get(name) || null;
    }
    return (name) => commands[name] || null;
}

/**
 * The command whose rule applies to `commandName`: itself, or the command its
 * `accessOf` points at. Null when the chain ends nowhere (unknown name, loop).
 */
function accessOwner(commandName, commands) {
    const get = commandLookup(commands);
    let name = String(commandName || "");
    for (let depth = 0; depth <= MAX_ACCESS_OF_DEPTH; depth++) {
        const command = get(name);
        if (!command) return null;
        if (!command.accessOf) return command;
        name = String(command.accessOf);
    }
    return null;
}

/**
 * The rule that applies to a command: `{ owner, mode, roleIds, source }`, where
 * source is "setting", "default" or "fallback" (nothing declared → admins).
 */
function ruleFor(commandName, { commands, config = {} } = {}) {
    const owner = accessOwner(commandName, commands);
    if (!owner) return { owner: null, mode: "admins", roleIds: [], source: "fallback" };
    const stored = normalizeBotCommandAccess(config.botCommandAccess)[owner.name];
    if (stored) return { owner: owner.name, ...stored, source: "setting" };
    const fallback = normalizeRule(owner.defaultAccess);
    if (fallback) return { owner: owner.name, ...fallback, source: "default" };
    return { owner: owner.name, mode: "admins", roleIds: [], source: "fallback" };
}

/** Whether the member counts as a full admin for the bot. */
function isBotAdmin(member, config = {}) {
    if (!member) return false;
    if (logcheckAdminIds.includes(String(member.id))) return true;
    const adminRoles = new Set([...(config.adminRoleIds || []), ...(envAdminRoleIds || [])].map(String));
    return (member.roleIds || []).some((id) => adminRoles.has(String(id)));
}

/**
 * May this member run the command? Pure: `member` is `{ id, roleIds }` (roleIds
 * of the event guild, [] when unknown), `ctx` carries the loaded commands and
 * the config. Returns `{ allowed, reason, rule }` with reason one of "admin",
 * "everyone", "role", "denied".
 */
function resolveBotAccess(commandName, member, ctx = {}) {
    const config = ctx.config || {};
    const rule = ruleFor(commandName, { commands: ctx.commands, config });
    if (isBotAdmin(member, config)) return { allowed: true, reason: "admin", rule };
    if (rule.mode === "everyone") return { allowed: true, reason: "everyone", rule };
    if (rule.mode === "roles" && member) {
        const held = new Set((member.roleIds || []).map(String));
        if (rule.roleIds.some((id) => held.has(id))) return { allowed: true, reason: "role", rule };
    }
    return { allowed: false, reason: "denied", rule };
}

/** The role ids of a GuildMember-like object, tolerating an unexpected shape. */
function roleIdsOf(member) {
    const cache = member && member.roles && member.roles.cache;
    if (!cache || typeof cache.keys !== "function") return [];
    return [...cache.keys()].map(String);
}

/**
 * The interacting user's roles on the event guild. Uses the interaction's own
 * member when it already happened there, else the cached member list of the
 * event guild, else a single fetch. Never throws — an unknown member has no roles.
 */
async function eventMemberRoles(interaction, guildId) {
    const userId = String(interaction.user && interaction.user.id);
    if (!guildId) return [];
    if (interaction.guild && String(interaction.guild.id) === guildId && interaction.member) {
        const roles = interaction.member.roles;
        if (Array.isArray(roles)) return roles.map(String);
        if (roles && roles.cache) return roleIdsOf(interaction.member);
    }
    const client = interaction.client || discord.getClient();
    const guild = discord.getGuild(guildId)
        || (client && client.guilds && client.guilds.cache && client.guilds.cache.get(guildId));
    if (!guild) return [];
    try {
        const members = await discord.fetchGuildMembersCached(guildId, guild);
        const found = members.find((m) => String(m.id) === userId);
        if (found) return roleIdsOf(found);
    } catch (e) {
        console.warn("botAccess: member list unavailable:", e.message);
    }
    try {
        return roleIdsOf(await guild.members.fetch(userId));
    } catch {
        return [];
    }
}

/**
 * "You need @Orga or @Raidleiter for this." — the names come from the event
 * guild. English: whoever is refused is mostly a raider who clicked an orga
 * button (e.g. "Call invites" under the setup message).
 */
function denyMessage(rule, guildId) {
    if (rule.mode !== "roles" || !rule.roleIds.length) return "This is reserved for admins.";
    const guild = discord.getGuild(guildId);
    const names = rule.roleIds.map((id) => {
        const role = guild && guild.roles && guild.roles.cache && guild.roles.cache.get(id);
        return `@${role ? role.name : "unknown role"}`;
    });
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
    return `You need ${list} for this.`;
}

/**
 * The gate bot.js runs before `command.execute`: resolves the access and, when
 * it is refused, answers with a short message only the user sees. Returns
 * whether the command may run.
 */
async function guardInteraction(interaction, command, commands) {
    const config = getConfig();
    const name = command && command.name;
    // "Jeder" needs no Discord lookup at all.
    const rule = ruleFor(name, { commands, config });
    const userId = String(interaction.user && interaction.user.id);
    if (rule.mode === "everyone") return true;
    const guildId = eventGuildId(config);
    const roleIds = await eventMemberRoles(interaction, guildId);
    const result = resolveBotAccess(name, { id: userId, roleIds }, { commands, config });
    if (result.allowed) return true;
    console.log(`Bot access denied: ${name} for ${userId}`);
    try {
        if (typeof interaction.isAutocomplete === "function" && interaction.isAutocomplete()) {
            await interaction.respond([]);
        } else if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: denyMessage(result.rule, guildId), flags: MessageFlags.Ephemeral });
        }
    } catch (e) {
        console.error("botAccess: deny reply failed:", e.message);
    }
    return false;
}

module.exports = {
    eventGuildId, accessOwner, ruleFor, isBotAdmin, resolveBotAccess,
    eventMemberRoles, denyMessage, guardInteraction,
};
