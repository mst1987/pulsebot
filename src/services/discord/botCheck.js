// Bot-Check of the Discord overview (docs/discord-servers.md "Discord-Übersicht"):
// which bot function needs which right, and whether the bot has it on one
// server of the list (#895), in the channels the settings name there, and
// whether a role it has to hand out stands above its own. A server is only
// checked for what is set up on it: the raid functions where raid categories
// are (or on the first server), the reactions where role messages stand.
//
// Everything comes from the discord.js cache (guild, own member, channels,
// roles) — no request to Discord, so the page can ask on every view. With the
// bot offline or not on the server a check reads "unknown", never "missing".
const { PermissionsBitField } = require("discord.js");
const discord = require("./discord");
const { roleBelowBot } = require("./memberRoles");
const rosterStore = require("../../stores/rosterStore");
const roleMessageStore = require("../../stores/roleMessageStore");
const addonCenterStore = require("../../stores/addonCenterStore");
const eventStore = require("../../stores/eventStore");
const { serverIds, talkGuildId, roleMessageGuild } = require("./guildRoles");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** German labels of every right and intent the table below names. */
const RIGHT_LABELS = {
    ViewChannel: "Kanäle ansehen",
    ManageChannels: "Kanäle verwalten",
    SendMessages: "Nachrichten senden",
    EmbedLinks: "Links einbetten",
    AddReactions: "Reaktionen hinzufügen",
    ReadMessageHistory: "Nachrichtenverlauf lesen",
    ManageRoles: "Rollen verwalten",
    ManageEvents: "Ereignisse verwalten",
    CreatePublicThreads: "Öffentliche Threads erstellen",
    SendMessagesInThreads: "Nachrichten in Threads senden",
    GuildMembers: "Mitglieder lesen (Intent)",
    MessageContent: "Nachrichteninhalt lesen (Intent)",
};
const INTENTS = ["GuildMembers", "MessageContent"];

/**
 * Function → the rights it needs on the server. `only` limits a function to
 * the servers where it is set up ("raids": raid categories or the first server,
 * "roleMessages": a role message stands there); elsewhere it reads "not_needed".
 */
const BOT_FUNCTIONS = [
    { key: "channels", label: "Kanäle anlegen und archivieren", needs: ["ManageChannels"], only: "raids" },
    { key: "posts", label: "Event-Posts, Anmelder-Nachricht, Setup, Pings", needs: ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"] },
    { key: "reactions", label: "Rollen-Nachrichten mit Reaktionen", needs: ["AddReactions", "ReadMessageHistory"], only: "roleMessages" },
    { key: "roles", label: "Raider-Rollen, Rollen-Nachrichten, Rollen-Abgleich", needs: ["ManageRoles"] },
    { key: "members", label: "Mitglieder- und Rollen-Abgleich, Neu und gegangen", needs: ["GuildMembers"] },
    { key: "events", label: "Raids als Discord-Server-Event", needs: ["ManageEvents"], only: "raids" },
    { key: "applications", label: "Bewerbungen als Thread", needs: ["CreatePublicThreads", "SendMessagesInThreads"], only: "raids" },
    { key: "logLinks", label: "Warcraft-Logs-Links in Log-Kanälen erkennen", needs: ["MessageContent"], only: "raids" },
];

const POST = ["ViewChannel", "SendMessages", "EmbedLinks"];

/**
 * The channels the settings name, by purpose. `guildId` pins a purpose to one
 * server; without it the channel counts for the server it lies on (a channel
 * that cannot be found then shows on the first server). `required` purposes
 * show "not_set" when no channel is configured.
 */
function channelPurposes(config) {
    const servers = config.discordServers || {};
    const out = [];
    const add = (key, label, channelId, needs, extra = {}) => out.push({ key, label, channelId: str(channelId), needs, ...extra });
    add("applications", "Bewerbungen", config.applicationChannelId, [...POST, "CreatePublicThreads", "SendMessagesInThreads"], { required: true });
    (config.logChannelIds || []).forEach((id) => add("logs", "Log-Kanal", id, [...POST, "ReadMessageHistory"]));
    add("talkPings", "Pings auf dem Talk-Server", servers.talkPingChannelId, POST, { guildId: str(talkGuildId(config)) });
    add("signupNotes", "Vielleicht und Absagen", servers.signupNoteChannelId, POST);
    for (const id of new Set(Object.values(config.categorySignupNoteChannel || {}).map(str))) add("signupNotes", "Vielleicht und Absagen (Kategorie)", id, POST);
    add("guildBank", "Gildenbank-Anfragen", servers.guildBankChannelId, POST);
    for (const l of servers.links || []) {
        if (l && l.channelId) add("overview", "Raid-Übersicht", l.channelId, [...POST, "ReadMessageHistory"], { guildId: str(l.to) });
    }
    const dungeon = config.dungeonRecords || {};
    if (dungeon.post) add("dungeonRecords", "Dungeon-Bestzeiten", dungeon.channelId, POST);
    add("addonCenter", "Addon-Zentrale", addonCenterStore.getSettings().channelId, [...POST, "ReadMessageHistory"]);
    return out.filter((p) => p.channelId || p.required);
}

function ownMember(guild) {
    return guild && guild.members ? guild.members.me || null : null;
}

function hasIntent(key) {
    const client = discord.getClient();
    const intents = client && client.options ? client.options.intents : null;
    return !!(intents && typeof intents.has === "function" && intents.has(key));
}

/** `[{ key, label, ok }]` of the given rights against a permission set (null = unknown). */
function rightsOf(keys, perms) {
    return keys.map((key) => ({
        key,
        label: RIGHT_LABELS[key] || key,
        ok: INTENTS.includes(key) ? hasIntent(key) : perms ? perms.has(PermissionsBitField.Flags[key]) : null,
    }));
}

const stateOf = (rights) => (rights.some((r) => r.ok === null) ? "unknown" : rights.every((r) => r.ok) ? "ok" : "missing");

/** A list read that may fail (a broken file): [] then. */
function safeList(read) {
    try {
        return read() || [];
    } catch {
        return [];
    }
}

/**
 * The raid categories the settings name: the category list plus every key of a
 * per-category map (`categoryRoles`, `categoryLanguage`, …).
 */
function configuredRaidCategories(config) {
    const ids = new Set();
    for (const id of Array.isArray(config.categoryIds) ? config.categoryIds : []) if (str(id)) ids.add(str(id));
    for (const [key, value] of Object.entries(config || {})) {
        if (key === "categoryIds" || !/^category[A-Z]/.test(key)) continue;
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        for (const id of Object.keys(value)) if (str(id)) ids.add(str(id));
    }
    return ids;
}

/** Does one of the configured raid categories lie on this server (discord.js cache)? */
function raidCategoryOn(gid, config, guild) {
    const client = discord.getClient();
    const clientCache = client && client.channels && client.channels.cache ? client.channels.cache : null;
    const guildCache = guild && guild.channels && guild.channels.cache ? guild.channels.cache : null;
    for (const id of configuredRaidCategories(config)) {
        if (guildCache && guildCache.has(id)) return true;
        const channel = clientCache ? clientCache.get(id) : null;
        if (channel && str(channel.guildId) === gid) return true;
    }
    return false;
}

/**
 * What is set up on a server: raids and role messages. Raids come only from
 * real raid sources — the first server, a stored event of this server with a
 * category, or a configured raid category lying on it. Read only: nothing is
 * written (a plain Discord category is no raid category).
 */
function setupOf(guildId, config, guild) {
    const gid = str(guildId);
    if (!gid) return { raids: false, roleMessages: false };
    const ids = serverIds(config);
    const raids = gid === ids[0]
        || safeList(() => eventStore.listEvents(gid)).some((e) => e && str(e.guildId) === gid && str(e.categoryId))
        || raidCategoryOn(gid, config, guild);
    const roleMessages = safeList(() => roleMessageStore.listMessages().filter((m) => roleMessageGuild(m, config) === gid));
    return { raids, roleMessages: roleMessages.length > 0 };
}

/** The server-wide table: one row per BOT_FUNCTIONS entry. */
function checkFunctions(guild, setup) {
    const me = ownMember(guild);
    const perms = me && me.permissions ? me.permissions : null;
    return BOT_FUNCTIONS.map((f) => {
        if (f.only && !setup[f.only]) return { key: f.key, label: f.label, state: "not_needed", rights: f.needs.map((key) => ({ key, label: RIGHT_LABELS[key] || key, ok: null })) };
        const rights = rightsOf(f.needs, perms);
        // Intents hold without a server; the rights need the own member.
        const known = perms || f.needs.every((k) => INTENTS.includes(k));
        return { key: f.key, label: f.label, state: known ? stateOf(rights) : "unknown", rights };
    });
}

/**
 * Which server a configured channel shows on: its pinned server, the server it
 * lies on, or the first server when that is unknown. A server outside the list
 * gives "" — left out, it is not "missing" anywhere.
 */
function serverOfChannel(purpose, config) {
    const ids = serverIds(config);
    const client = discord.getClient();
    const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(purpose.channelId) : null;
    const gid = purpose.guildId || (channel && str(channel.guildId));
    if (!gid) return ids[0] || "";
    return ids.includes(gid) ? gid : "";
}

/** One configured channel of this server: found, rights, or why not. */
function checkChannel(purpose, guild, online) {
    const base = { key: purpose.key, label: purpose.label, channelId: purpose.channelId, channelName: "" };
    if (!purpose.channelId) return { ...base, state: "not_set", missing: [], missingKeys: [] };
    if (!online || !guild) return { ...base, state: "unknown", missing: [], missingKeys: [] };
    const channel = guild.channels && guild.channels.cache ? guild.channels.cache.get(purpose.channelId) : null;
    if (!channel) return { ...base, state: "channel_missing", missing: [], missingKeys: [] };
    const me = ownMember(guild);
    const perms = me && typeof channel.permissionsFor === "function" ? channel.permissionsFor(me) : null;
    const rights = me ? rightsOf(purpose.needs, perms || { has: () => false }) : rightsOf(purpose.needs, null);
    const lacking = rights.filter((r) => r.ok === false);
    const missing = lacking.map((r) => r.label);
    // missingKeys: the same rights as keys, for a client that names them in its own language
    const missingKeys = lacking.map((r) => r.key);
    return { ...base, channelName: str(channel.name), state: me ? (missing.length ? "missing" : "ok") : "unknown", missing, missingKeys };
}

/** The ids of the roles the bot hands out on this server, each with what uses it. */
function rolesInUse(guildId, config) {
    const gid = str(guildId);
    const uses = new Map();
    const add = (id, what) => {
        const rid = str(id);
        if (!rid) return;
        if (!uses.has(rid)) uses.set(rid, new Set());
        uses.get(rid).add(what);
    };
    for (const roster of rosterStore.listRosters("")) {
        if (rosterStore.isClosed(roster)) continue;
        for (const id of roster.roleIds || []) add(id, `Roster ${roster.name}`);
        add(roster.trialRoleId, `Roster ${roster.name}`);
    }
    for (const m of roleMessageStore.listMessages()) {
        if (roleMessageGuild(m, config) !== gid) continue;
        for (const r of m.roles || []) add(r.roleId, "Rollen-Nachricht");
    }
    // A role-sync pair (#896) names its servers: only this server's role of it counts.
    for (const entry of config.roleSync || []) {
        if (str(entry.fromGuildId) === gid) add(entry.fromRoleId, "Rollen-Abgleich");
        if (str(entry.toGuildId) === gid) add(entry.toRoleId, "Rollen-Abgleich");
    }
    // The addon centre hands its ping role out per button; it counts where it exists.
    add(addonCenterStore.getSettings().roleId, "Addon-Zentrale");
    return uses;
}

/**
 * Roles the bot hands out on this server that stand at or above its highest
 * role (or are owned by an integration): it cannot give them. Only roles that
 * exist on the server count — a roster's role on the other server is no hint.
 */
function rolesAboveBot(guild, guildId, config) {
    const me = ownMember(guild);
    if (!guild || !guild.roles || !guild.roles.cache || !me || !me.roles || !me.roles.highest) return [];
    const out = [];
    for (const [id, what] of rolesInUse(guildId, config)) {
        const role = guild.roles.cache.get(id);
        if (!role) continue;
        if (!roleBelowBot(guild, role)) out.push({ id, name: str(role.name), usedBy: [...what].sort() });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The whole check of one server: `{ guildId, known, functions, channels, rolesAboveBot }`.
 * `known` false = bot offline or not on that server: every state is "unknown".
 */
function botCheck(guildId, config) {
    const gid = str(guildId);
    const online = discord.isOnline();
    const guild = gid && online ? discord.getGuild(gid) : null;
    const channels = gid
        ? channelPurposes(config)
            .filter((p) => serverOfChannel(p, config) === gid)
            .map((p) => checkChannel(p, guild, online))
        : [];
    return {
        guildId: gid,
        known: !!(guild && ownMember(guild)),
        functions: checkFunctions(guild, setupOf(gid, config, guild)),
        channels,
        rolesAboveBot: rolesAboveBot(guild, gid, config),
    };
}

module.exports = { botCheck, channelPurposes, BOT_FUNCTIONS, RIGHT_LABELS };
