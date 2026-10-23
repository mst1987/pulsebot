// Bot-Check of the Discord overview (docs/discord-servers.md "Discord-Übersicht"):
// which bot function needs which right, and whether the bot has it on the
// server of one side (event / talk), in the channels the settings name, and
// whether a role it has to hand out stands above its own.
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
 * Function → the rights it needs on the server. `sides` limits a function to
 * the servers it runs on; elsewhere it reads "not_needed".
 */
const BOT_FUNCTIONS = [
    { key: "channels", label: "Kanäle anlegen und archivieren", needs: ["ManageChannels"] },
    { key: "posts", label: "Event-Posts, Anmelder-Nachricht, Setup, Pings", needs: ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"] },
    { key: "reactions", label: "Rollen-Nachrichten mit Reaktionen", needs: ["AddReactions", "ReadMessageHistory"] },
    { key: "roles", label: "Raider-Rollen, Rollen-Nachrichten, Rollen-Abgleich", needs: ["ManageRoles"] },
    { key: "members", label: "Mitglieder- und Rollen-Abgleich, Neu und gegangen", needs: ["GuildMembers"] },
    { key: "events", label: "Raids als Discord-Server-Event", needs: ["ManageEvents"], sides: ["event"] },
    { key: "applications", label: "Bewerbungen als Thread", needs: ["CreatePublicThreads", "SendMessagesInThreads"], sides: ["event"] },
    { key: "logLinks", label: "Warcraft-Logs-Links in Log-Kanälen erkennen", needs: ["MessageContent"], sides: ["event"] },
];

const POST = ["ViewChannel", "SendMessages", "EmbedLinks"];

/**
 * The channels the settings name, by purpose. `side` pins a purpose to one
 * server; without it the channel counts for the server it lies on (a channel
 * that cannot be found then shows on the event side). `required` purposes show
 * "not_set" when no channel is configured.
 */
function channelPurposes(config) {
    const servers = config.discordServers || {};
    const out = [];
    const add = (key, label, channelId, needs, extra = {}) => out.push({ key, label, channelId: str(channelId), needs, ...extra });
    add("applications", "Bewerbungen", config.applicationChannelId, [...POST, "CreatePublicThreads", "SendMessagesInThreads"], { required: true });
    (config.logChannelIds || []).forEach((id) => add("logs", "Log-Kanal", id, [...POST, "ReadMessageHistory"]));
    add("talkPings", "Pings auf dem Talk-Server", servers.talkPingChannelId, POST, { side: "talk" });
    add("signupNotes", "Vielleicht und Absagen", servers.signupNoteChannelId, POST);
    for (const id of new Set(Object.values(config.categorySignupNoteChannel || {}).map(str))) add("signupNotes", "Vielleicht und Absagen (Kategorie)", id, POST);
    add("guildBank", "Gildenbank-Anfragen", servers.guildBankChannelId, POST);
    for (const g of servers.eventGuilds || []) {
        if (g && g.overviewChannelId) add("overview", "Raid-Übersicht", g.overviewChannelId, [...POST, "ReadMessageHistory"], { guildId: str(g.overviewGuildId) });
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

/** The server-wide table: one row per BOT_FUNCTIONS entry. */
function checkFunctions(guild, side) {
    const me = ownMember(guild);
    const perms = me && me.permissions ? me.permissions : null;
    return BOT_FUNCTIONS.map((f) => {
        if (f.sides && !f.sides.includes(side)) return { key: f.key, label: f.label, state: "not_needed", rights: f.needs.map((key) => ({ key, label: RIGHT_LABELS[key] || key, ok: null })) };
        const rights = rightsOf(f.needs, perms);
        // Intents hold without a server; the rights need the own member.
        const known = perms || f.needs.every((k) => INTENTS.includes(k));
        return { key: f.key, label: f.label, state: known ? stateOf(rights) : "unknown", rights };
    });
}

/**
 * Which side a configured channel shows on: its pinned side, its server, or
 * event when its server is unknown. "other" = it lies on a server that is
 * neither side (a second event server) — left out, it is not "missing" here.
 */
function sideOfChannel(purpose, guildIds) {
    if (purpose.side) return purpose.side;
    const client = discord.getClient();
    const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(purpose.channelId) : null;
    const gid = purpose.guildId || (channel && str(channel.guildId));
    if (!gid || gid === guildIds.event) return "event";
    if (gid === guildIds.talk) return "talk";
    return "other";
}

/** One configured channel of this side: found, rights, or why not. */
function checkChannel(purpose, guild, online) {
    const base = { key: purpose.key, label: purpose.label, channelId: purpose.channelId, channelName: "" };
    if (!purpose.channelId) return { ...base, state: "not_set", missing: [] };
    if (!online || !guild) return { ...base, state: "unknown", missing: [] };
    const channel = guild.channels && guild.channels.cache ? guild.channels.cache.get(purpose.channelId) : null;
    if (!channel) return { ...base, state: "channel_missing", missing: [] };
    const me = ownMember(guild);
    const perms = me && typeof channel.permissionsFor === "function" ? channel.permissionsFor(me) : null;
    const rights = me ? rightsOf(purpose.needs, perms || { has: () => false }) : rightsOf(purpose.needs, null);
    const missing = rights.filter((r) => r.ok === false).map((r) => r.label);
    return { ...base, channelName: str(channel.name), state: me ? (missing.length ? "missing" : "ok") : "unknown", missing };
}

/** The ids of the roles the bot hands out on this server, each with what uses it. */
function rolesInUse(side, config) {
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
        if (m.guildSide !== side) continue;
        for (const r of m.roles || []) add(r.roleId, "Rollen-Nachricht");
    }
    for (const entry of config.roleSync || []) add(side === "talk" ? entry.talkRoleId : entry.eventRoleId, "Rollen-Abgleich");
    // The addon centre hands its ping role out per button; it counts where it exists.
    add(addonCenterStore.getSettings().roleId, "Addon-Zentrale");
    return uses;
}

/**
 * Roles the bot hands out on this server that stand at or above its highest
 * role (or are owned by an integration): it cannot give them. Only roles that
 * exist on the server count — a roster's role on the other server is no hint.
 */
function rolesAboveBot(guild, side, config) {
    const me = ownMember(guild);
    if (!guild || !guild.roles || !guild.roles.cache || !me || !me.roles || !me.roles.highest) return [];
    const out = [];
    for (const [id, what] of rolesInUse(side, config)) {
        const role = guild.roles.cache.get(id);
        if (!role) continue;
        if (!roleBelowBot(guild, role)) out.push({ id, name: str(role.name), usedBy: [...what].sort() });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The whole check of one side: `{ guildId, known, functions, channels, rolesAboveBot }`.
 * `known` false = bot offline or not on that server: every state is "unknown".
 */
function botCheck(side, guildId, config, guildIds = {}) {
    const gid = str(guildId);
    const online = discord.isOnline();
    const guild = gid && online ? discord.getGuild(gid) : null;
    const channels = channelPurposes(config)
        .filter((p) => sideOfChannel(p, guildIds) === side)
        .map((p) => checkChannel(p, guild, online));
    return {
        guildId: gid,
        known: !!(guild && ownMember(guild)),
        functions: checkFunctions(guild, side),
        channels,
        rolesAboveBot: rolesAboveBot(guild, side, config),
    };
}

module.exports = { botCheck, channelPurposes, BOT_FUNCTIONS, RIGHT_LABELS };
