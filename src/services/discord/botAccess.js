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
// Since #925 the rules are per Discord server: an interaction on a server is
// judged by that server's botCommandAccess and the member's roles there - a role
// on server B opens nothing on server A. The full admins (.env, the admin roles
// of Zugang on ANY server) pass everywhere. A DM has no server: it is judged by
// the server of the record it is about (the command's optional
// `guildIdOf(interaction)`), and without one by no server at all - then only a
// full admin passes a rule that is not "everyone" (fail closed).
const { card } = require("../../utils/discord/card");
const { getConfig } = require("../../stores/settings/settingsStore");
const discord = require("./discord");
const { logcheckAdminIds, adminRoleIds: envAdminRoleIds } = require("../../config/variables");
const { configForGuild, fullAdminRoleIds, interactionGuildId } = require("./servers/serverAccess");
const userAccess = require("./members/userAccess");
const { normalizeRule, normalizeBotCommandAccess } = require("../../config/botCommands");
const { langOfInteraction } = require("./botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { hasFeature } = require("../plans/serverPlan");
const { serverIsTrusted, listedServerIds } = require("./roles/guildRoles");
const { PermissionFlagsBits } = require("discord.js");

// accessOf chains are one link deep in practice; the cap only guards a loop.
// The "full admin on another server" answer: remembered a short while per user, and never
// waited for longer than Discord leaves to answer an interaction (3 s) allows.
const ADMIN_CACHE_MS = 60 * 1000;
const ADMIN_LOOKUP_MS = 1500;
const ADMIN_CACHE_MAX = 500;
const adminAnywhere = new Map(); // userId -> { at, value } | { pending }
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
    const adminRoles = new Set([...fullAdminRoleIds(config), ...(envAdminRoleIds || [])].map(String));
    return (member.roleIds || []).some((id) => adminRoles.has(String(id)));
}

/**
 * May this member run the command? Pure: `member` is `{ id, roleIds }` (roleIds
 * of the event guild, [] when unknown), `ctx` carries the loaded commands and
 * the config. Returns `{ allowed, reason, rule }` with reason one of "admin",
 * "everyone", "role", "denied". `ctx.fullAdminOnly`: the rule of the server does
 * not count, only a full admin passes (a command on shared data, guardInteraction).
 */
function resolveBotAccess(commandName, member, ctx = {}) {
    const config = ctx.config || {};
    const rule = ruleFor(commandName, { commands: ctx.commands, config });
    if (isBotAdmin(member, config)) return { allowed: true, reason: "admin", rule };
    if (ctx.fullAdminOnly) return { allowed: false, reason: "denied", rule };
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
        // at most ADMIN_LOOKUP_MS: a hanging fetch means no roles (fail closed), never a hung check
        return roleIdsOf(await withTimeout(Promise.resolve().then(() => guild.members.fetch(userId)), ADMIN_LOOKUP_MS, null));
    } catch {
        return [];
    }
}

/**
 * "You need @Orga or @Raidleiter for this." — the names come from the event
 * guild. In the language of whoever is refused (`lang`): mostly a raider who
 * clicked an orga button (e.g. "Call invites" under the setup message).
 */
function denyMessage(rule, guildId, lang = "de") {
    if (rule.mode !== "roles" || !rule.roleIds.length) return tr(lang, "This is reserved for admins.");
    const guild = discord.getGuild(guildId);
    const names = rule.roleIds.map((id) => {
        const role = guild && guild.roles && guild.roles.cache && guild.roles.cache.get(id);
        return `@${role ? role.name : tr(lang, "unknown role")}`;
    });
    const roles = names.length > 1
        ? tr(lang, "{first} or {last}", { first: names.slice(0, -1).join(", "), last: names[names.length - 1] })
        : names[0];
    return tr(lang, "You need {roles} for this.", { roles });
}

/**
 * The gate bot.js runs before `command.execute`: resolves the access and, when
 * it is refused, answers with a short message only the user sees. Returns
 * whether the command may run.
 */
async function guardInteraction(interaction, command, commands) {
    const stored = getConfig();
    // the server the interaction came from; a DM: the record's server, else none (#925)
    const guildId = interactionGuildId(interaction, { recordGuildId: await recordGuildOf(command, interaction) });
    const config = configForGuild(stored, guildId);
    const name = command && command.name;
    const lang = () => langOfInteraction(interaction, { config });
    // The plan of the server (docs/server-plans.md) before any right: it holds for everyone,
    // admins too. A button or modal goes by the command it belongs to (`accessOf`).
    const feature = commandFeature(command, commands);
    if (feature && !hasFeature(guildId, feature)) {
        console.log(`Bot access denied: ${name} on ${guildId} needs feature ${feature}`);
        await refuse(interaction, () => tr(lang(), "This feature is not part of this server's plan."));
        return false;
    }
    // "Jeder" needs no Discord lookup at all.
    const rule = ruleFor(name, { commands, config });
    const userId = String(interaction.user && interaction.user.id);
    // Data every server shares (#1073): a server's rule counts only with the mark of a full admin,
    // asked of the stored config. No server (a DM without a record) has no mark either.
    const fullAdminOnly = commandSharesData(command, commands) && !serverIsTrusted(guildId, stored);
    if (rule.mode === "everyone" && !fullAdminOnly) return true;
    const roleIds = await eventMemberRoles(interaction, guildId);
    const result = resolveBotAccess(name, { id: userId, roleIds }, { commands, config, fullAdminOnly });
    if (result.allowed) return true;
    // The rank Server-Admin (#1073): on its own listed server it passes every rule a server
    // could set there, "Nur Admins" too - never a command on shared data (#1072, Projektfalle 32),
    // not even on a marked server, and never in a DM without a record (no server, no rank).
    if (!commandSharesData(command, commands) && await isServerAdminOf(interaction, guildId, stored)) {
        console.log(`Bot access: ${name} for ${userId} as server admin of ${guildId}`);
        return true;
    }
    // a full admin through an admin role on another server (#925): asked only on a refusal
    if (await isFullAdminAnywhere(userId)) return true;
    console.log(`Bot access denied: ${name} for ${userId}`);
    await refuse(interaction, () => (fullAdminOnly
        ? tr(lang(), "This command reaches data every server shares, and this server is not cleared for that.")
        : denyMessage(result.rule, guildId, lang())));
    return false;
}

/** The plan feature a command needs: its own `feature`, else that of the command whose rule it follows. */
function commandFeature(command, commands) {
    if (!command) return "";
    if (command.feature) return command.feature;
    const owner = accessOwner(command.name, commands);
    return (owner && owner.feature) || "";
}

/** Whether a command reaches data every server shares: its own `sharedData`, else that of the command whose rule it follows. */
function commandSharesData(command, commands) {
    if (!command) return false;
    if (command.sharedData === true) return true;
    const owner = accessOwner(command.name, commands);
    return !!owner && owner.sharedData === true;
}

/** Answers a refused interaction with a message only the user sees (`title` is asked only when one is sent). */
async function refuse(interaction, title) {
    try {
        if (typeof interaction.isAutocomplete === "function" && interaction.isAutocomplete()) {
            await interaction.respond([]);
        } else if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(card({ kind: "error", title: title(), ephemeral: true }));
        }
    } catch (e) {
        console.error("botAccess: deny reply failed:", e.message);
    }
}

/**
 * The server of the record a DM interaction is about: the command's own
 * `guildIdOf(interaction)` (sync or async). "" in a server (the click names it),
 * without the hook, or when it fails.
 */
async function recordGuildOf(command, interaction) {
    if (interaction && (interaction.guildId || interaction.guild)) return "";
    if (!command || typeof command.guildIdOf !== "function") return "";
    try {
        return String((await command.guildIdOf(interaction)) || "").trim();
    } catch (e) {
        console.warn("botAccess: record server unknown:", e.message);
        return "";
    }
}

/** A promise that settles with `fallback` after `ms` when `promise` has not settled by then. */
async function withTimeout(promise, ms, fallback) {
    let timer;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
        if (timer.unref) timer.unref();
    });
    try {
        return await Promise.race([promise, late]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Whether the user holds the rank Server-Admin on `guildId` - the definition of the web
 * (userAccess.computeGuildAccess): Discord's "Administrator" right or the ownership of a
 * server of `discordServers.servers`; the home guild or an overview target outside that
 * list never gives it. On the server itself the interaction carries the answer
 * (`memberPermissions`, resolved by Discord - no fetch, no delay); in a DM about a record
 * the member is fetched from that server, at most ADMIN_LOOKUP_MS, else "no" (fail closed).
 * Without a server (a DM without a record) never.
 */
async function isServerAdminOf(interaction, guildId, stored) {
    const gid = String(guildId || "").trim();
    if (!gid || !interaction) return false;
    let listed;
    try {
        listed = new Set(listedServerIds(stored).map((id) => String(id).trim()));
    } catch {
        return false;
    }
    if (!listed.has(gid)) return false;
    const userId = String(interaction.user && interaction.user.id || "");
    if (!userId) return false;
    const clickedId = String(interaction.guildId || (interaction.guild && interaction.guild.id) || "");
    if (clickedId) {
        if (clickedId !== gid) return false;
        const guild = interaction.guild;
        if (guild && guild.ownerId && String(guild.ownerId) === userId) return true;
        const perms = interaction.memberPermissions;
        try {
            return !!perms && typeof perms.has === "function" && perms.has(PermissionFlagsBits.Administrator) === true;
        } catch {
            return false;
        }
    }
    const client = interaction.client || discord.getClient();
    const guild = discord.getGuild(gid)
        || (client && client.guilds && client.guilds.cache && client.guilds.cache.get(gid));
    if (!guild || !guild.members || typeof guild.members.fetch !== "function") return false;
    if (guild.ownerId && String(guild.ownerId) === userId) return true;
    const lookup = Promise.resolve()
        .then(() => guild.members.fetch(userId))
        .then((member) => userAccess.memberIsDiscordAdmin(member), () => false);
    return withTimeout(lookup, ADMIN_LOOKUP_MS, false);
}

/**
 * For a gate outside the router that asks a rule by name (a button prefix, a reaction):
 * whether the rank Server-Admin passes it, exactly as in guardInteraction - never for a
 * rule on shared data, only on `guildId` itself. Never throws.
 */
async function serverAdminPasses(commandName, interaction, guildId, { commands, stored } = {}) {
    try {
        if (commandSharesData({ name: String(commandName || "") }, commands)) return false;
        return await isServerAdminOf(interaction, guildId, stored || getConfig());
    } catch {
        return false;
    }
}

/** The role lookup behind isFullAdminAnywhere, shared by every caller while it runs. */
function adminLookup(userId) {
    const hit = adminAnywhere.get(userId);
    if (hit && hit.pending) return hit.pending;
    const pending = Promise.resolve()
        .then(() => userAccess.resolveGuildAccess(userId))
        .then((ga) => !!(ga && ga.isAdmin), () => false)
        .then((value) => {
            if (adminAnywhere.size >= ADMIN_CACHE_MAX) adminAnywhere.clear();
            adminAnywhere.set(userId, { at: Date.now(), value });
            return value;
        });
    adminAnywhere.set(userId, { pending });
    return pending;
}

/**
 * Whether the account is a full admin through an admin role on any server
 * (userAccess). Asked only after a refusal; the interaction's own roles were
 * already checked by isBotAdmin. The answer is cached for a minute, and a
 * lookup slower than ADMIN_LOOKUP_MS counts as "no" (fail closed) while it
 * goes on filling the cache - so the refusal still reaches Discord in time.
 */
async function isFullAdminAnywhere(userId, { timeoutMs = ADMIN_LOOKUP_MS } = {}) {
    if (!fullAdminRoleIds(getConfig()).length && !(envAdminRoleIds || []).length) return false;
    const id = String(userId || "");
    if (!id) return false;
    const hit = adminAnywhere.get(id);
    if (hit && !hit.pending && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.value;
    return withTimeout(adminLookup(id), timeoutMs, false);
}

/** Tests: forget the cached admin answers. */
function resetAdminCache() {
    adminAnywhere.clear();
}

module.exports = {
    isFullAdminAnywhere, isServerAdminOf, serverAdminPasses, resetAdminCache, recordGuildOf,
    accessOwner, ruleFor, isBotAdmin, resolveBotAccess,
    eventMemberRoles, denyMessage, guardInteraction, withTimeout, ADMIN_LOOKUP_MS,
};
