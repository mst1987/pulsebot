// Bridge between the web admin menu and the Discord bot client: list servers /
// channels, and post / edit / scan recruitment messages. The client is injected
// from the web server startup (which receives it from bot.js). This is the one
// holder of the client: everything else (auth included) reads it via getClient().

const {
    ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField,
} = require("discord.js");
const { embedAccentColor } = require("../../config/variables");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { buildEmbed } = require("../../utils/discord/reply");
const { card, cardFromEmbed } = require("../../utils/discord/card");

let client = null;
function setClient(c) {
    client = c;
}
function getClient() {
    return client;
}

/** Whether the bot client is there (and, when it can say so, logged in). */
function isOnline() {
    return !!client && (typeof client.isReady !== "function" || client.isReady());
}

/**
 * A text channel of the given client (announcement channels and threads count).
 * Throws "Bot nicht verbunden." (code "bot_offline") without a client and
 * `notFound` (code "channel_not_found") for a channel that is missing or cannot
 * hold messages; Discord's own errors (unknown channel, missing access) pass through.
 */
async function textChannelOf(c, channelId, notFound = "Kanal nicht gefunden oder kein Textkanal.") {
    if (!c) throw Object.assign(new Error("Bot nicht verbunden."), { code: "bot_offline" });
    const channel = await c.channels.fetch(String(channelId || ""));
    if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
        throw Object.assign(new Error(notFound), { code: "channel_not_found" });
    }
    return channel;
}

/** A text channel of the bot, fetched through its client (see textChannelOf). */
function fetchTextChannel(channelId, notFound) {
    return textChannelOf(client, channelId, notFound);
}

// The apply button carries the game version of its applications (#553):
// "apply:<versionId>", or the bare "apply" of a message from before.
const { applyButtonId, isApplyButtonId, versionOfApplyButton, VERSION_FIELD, versionOfFieldValue } = require("../../utils/recruitment/applyVersion");
// Button under a detected log; customId carries the tracked log id after the ":".
const LOG_EVAL_PREFIX = "logcheck-eval";
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// A thread's parentId points at the text channel it hangs off, not a category —
// the Kanäle page needs this to nest it under that channel instead of "Ohne Kategorie".
const THREAD_TYPES = [ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread];

// Channel types the admin menu can create, keyed by the value the form sends.
const CREATABLE_CHANNEL_TYPES = {
    text: ChannelType.GuildText,
    voice: ChannelType.GuildVoice,
    announcement: ChannelType.GuildAnnouncement,
    forum: ChannelType.GuildForum,
    stage: ChannelType.GuildStageVoice,
};

// Human labels for the channel types we surface (used when listing channels).
const CHANNEL_TYPE_LABELS = {
    [ChannelType.GuildText]: "Text",
    [ChannelType.GuildVoice]: "Voice",
    [ChannelType.GuildAnnouncement]: "Ankündigung",
    [ChannelType.GuildForum]: "Forum",
    [ChannelType.GuildStageVoice]: "Stage",
    [ChannelType.GuildCategory]: "Kategorie",
    [ChannelType.AnnouncementThread]: "Thread",
    [ChannelType.PublicThread]: "Thread",
    [ChannelType.PrivateThread]: "Privater Thread",
};

/** Servers (guilds) the bot is a member of, for the server selector. */
function listGuilds() {
    if (!client) return [];
    return [...client.guilds.cache.values()]
        .map((g) => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function getGuild(guildId) {
    return client && guildId ? client.guilds.cache.get(guildId) : null;
}

/** Roles of a guild that can be pinged (excludes @everyone), highest first. */
function listRoles(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    return [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id) // drop @everyone
        .sort((a, b) => (b.rawPosition || 0) - (a.rawPosition || 0))
        // color: the role's hex colour, "" for an uncoloured role — the
        // permission matrix tints a role's tile with it.
        .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : "" }));
}

/**
 * Map every channel of a guild to its parent category, so event channelIds can
 * be grouped by Discord category. Returns { [channelId]: { name, categoryId, categoryName } }.
 */
function getChannelCategoryMap(guildId) {
    const guild = getGuild(guildId);
    const map = {};
    if (!guild) return map;
    for (const c of guild.channels.cache.values()) {
        map[c.id] = {
            name: c.name,
            categoryId: c.parent ? c.parent.id : "",
            categoryName: c.parent ? c.parent.name : "",
        };
    }
    return map;
}

/**
 * Post a sign-up announcement into a channel, pinging the given roles: ONE card (utils/discord/card.js) — the role and
 * member mentions are its first line (they ping from a card, tried on the dev server), then the notify template's title and
 * body. Before it was mentions in `content` over an embed, two stacked blocks.
 * @returns { guildId, channelId, messageId, url }
 */
async function postAnnouncement(channelId, template, roleIds = [], userIds = []) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");

    const roles = (roleIds || []).filter(Boolean);
    // Single members are mentioned where a role cannot be: on the talk server
    // an event-server role means nothing (see pingDelivery.js).
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    const mentions = [...roles.map((id) => `<@&${id}>`), ...users.map((id) => `<@${id}>`)].join(" ");
    if (!mentions && !template.title && !template.body) {
        throw new Error("Nachricht ist leer — Vorlage oder Rollen wählen.");
    }
    const payload = card({
        mentions, title: template.title, text: template.body,
        allowedMentions: users.length ? { roles, users } : { roles },
    });

    const posted = await channel.send(payload);
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url };
}

// `guild.members.fetch()` pulls the WHOLE member list over the gateway on every
// call — there is no incremental variant for "everyone with role X". The event
// detail page does it once, and the ping that follows it seconds later used to
// pay for it a second time; together with the Raid-Helper round trip that
// pushed POST /api/raids/ping-missing past the reverse proxy's 60s ceiling, so
// the admin got a 504 and nothing was ever posted. Cache the fetched list
// briefly per guild: the ping then pings exactly the roster the page just
// showed, and role changes are picked up again after the TTL.
const MEMBERS_CACHE_TTL_MS = 60_000;
// Cap the fetch itself too — discord.js waits 120s by default, which is already
// twice the proxy's patience.
const MEMBERS_FETCH_TIMEOUT_MS = 25_000;
const membersCache = new Map(); // guildId -> { at, members: Array<GuildMember> }

/** Test-only: drop the member cache. Production code never calls this. */
function _resetMembersCacheForTests() {
    membersCache.clear();
}

/**
 * All members of a guild, cached for MEMBERS_CACHE_TTL_MS. Throws whatever the
 * fetch throws (missing GuildMembers intent, timeout) — a failure is never cached.
 */
async function fetchGuildMembersCached(guildId, guild) {
    const cached = membersCache.get(guildId);
    if (cached && Date.now() - cached.at < MEMBERS_CACHE_TTL_MS) return cached.members;
    const fetched = await guild.members.fetch({ time: MEMBERS_FETCH_TIMEOUT_MS });
    const members = [...fetched.values()];
    membersCache.set(guildId, { at: Date.now(), members });
    return members;
}

// What the bot needs on a server (Einstellungen → Verbindungen → Discord-Server).
// "Mitglieder lesen" is no channel permission but the privileged GuildMembers
// intent — without it the member list (attendance, overlap, role sync) is empty.
const REQUIRED_BOT_PERMISSIONS = [
    { key: "ManageChannels", label: "Kanäle verwalten" },
    { key: "SendMessages", label: "Nachrichten senden" },
    { key: "EmbedLinks", label: "Links einbetten" },
    { key: "ManageRoles", label: "Rollen verwalten" },
    { key: "GuildMembers", label: "Mitglieder lesen", intent: true },
];

/**
 * The bot's rights on one server, one entry per REQUIRED_BOT_PERMISSIONS item:
 * `[{ key, label, ok }]`. Null when nothing can be known — the bot is not on
 * that server or not connected yet — which the page must show as "unknown",
 * never as "every right missing".
 */
function botPermissionsIn(guildId) {
    const guild = getGuild(guildId);
    const me = guild && guild.members ? guild.members.me : null;
    if (!guild || !me || !me.permissions) return null;
    const intents = client && client.options ? client.options.intents : null;
    return REQUIRED_BOT_PERMISSIONS.map((p) => ({
        key: p.key,
        label: p.label,
        ok: p.intent
            ? !!(intents && typeof intents.has === "function" && intents.has(p.key))
            : me.permissions.has(PermissionsBitField.Flags[p.key]),
    }));
}

/**
 * Guild members that hold at least one of the given roles, for the event
 * attendance check. Fetching the full member list needs the privileged
 * GuildMembers intent ("Server Members Intent" in the Developer Portal); when it
 * is missing (or the fetch fails) this returns an empty list plus an error so the
 * UI can degrade gracefully instead of crashing.
 * @returns {Promise<{ members: {id:string, displayName:string}[], error: string|null }>}
 */
async function listMembersWithRoles(guildId, roleIds = []) {
    const guild = getGuild(guildId);
    if (!guild) return { members: [], error: "Server nicht gefunden oder Bot nicht verbunden." };
    const wanted = new Set((roleIds || []).map(String).filter(Boolean));
    if (!wanted.size) return { members: [], error: null };
    try {
        const all = await fetchGuildMembersCached(guildId, guild);
        const members = all
            .filter((m) => [...wanted].some((id) => m.roles.cache.has(id)))
            .map((m) => ({ id: m.id, displayName: m.displayName || m.user.username }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        return { members, error: null };
    } catch (e) {
        return { members: [], error: (e && e.message) || "Mitglieder konnten nicht geladen werden (GuildMembers-Intent aktiv?)." };
    }
}

/** A member's avatar URL (server avatar, else the account's), null when none can be built. */
function avatarUrlOf(member) {
    try {
        return typeof member.displayAvatarURL === "function" ? member.displayAvatarURL({ size: 64 }) || null : null;
    } catch {
        return null;
    }
}

/**
 * Every human (non-bot) member of a guild, for the Kaderplaner
 * (docs/kaderplaner.md): name, avatar and the ids of their roles (the
 * @everyone role left out) — the import from Discord roles works on those.
 * Same cached full fetch as listMembersWithRoles(), so it needs the
 * GuildMembers intent too; a failure comes back as `error` with an empty list,
 * never thrown.
 * @returns {Promise<{ members: {id:string, displayName:string, avatarUrl:string|null, roleIds:string[]}[], error: string|null }>}
 */
async function listHumanMembers(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return { members: [], error: "Server nicht gefunden oder Bot nicht verbunden." };
    try {
        const all = await fetchGuildMembersCached(guildId, guild);
        const members = all
            .filter((m) => m && m.user && !m.user.bot)
            .map((m) => ({
                id: m.id,
                displayName: m.displayName || m.user.globalName || m.user.username || m.id,
                avatarUrl: avatarUrlOf(m),
                roleIds: m.roles && m.roles.cache ? [...m.roles.cache.keys()].filter((id) => id !== guild.id) : [],
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        return { members, error: null };
    } catch (e) {
        return { members: [], error: (e && e.message) || "Mitglieder konnten nicht geladen werden (GuildMembers-Intent aktiv?)." };
    }
}

// The pings are cards (Oct 2026, utils/discord/card.js): kind "warn", the mentions
// as the card's first line — a mention in a container notifies like one in
// `content` (tried on the dev server) — and the text under them. Aliased, so a
// `card` import elsewhere in this file can never clash with it.
const { card: pingCard, CARD_TEXT_LIMIT: PING_CARD_LIMIT } = require("../../utils/discord/card");

/**
 * The ping as card parts: the mentions split so each card stays under Discord's
 * 4000 characters of text (a mention costs about 22 — ~180 missing raiders would
 * not fit one), the text on the last card. `[{ mentions, text }]`, at least one.
 */
function pingParts(users, body) {
    const chunks = users.length ? mentionChunks(users.map((id) => `<@${id}>`), PING_CARD_LIMIT - body.length - 8) : [""];
    return chunks.map((mentions, i) => ({ mentions, text: i === chunks.length - 1 ? body : "" }));
}

/**
 * Ping the given users in a channel, asking them to sign up or off for an event:
 * one card (kind "warn") per chunk of mentions, the mentions as its first line so
 * they actually notify; allowedMentions is scoped to exactly those users.
 * @returns {Promise<{ channelId, messageId, url }>}
 */
async function postMissingPing(channelId, userIds = [], text = "") {
    if (!client) throw new Error("Bot nicht verbunden.");
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    if (!users.length) throw new Error("Keine fehlenden Raider zum Pingen.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const body = String(text || "").trim()
        || "Please sign up or sign off for the raid, so the roster is complete.";
    let first = null;
    const messageIds = [];
    for (const part of pingParts(users, body)) {
        const posted = await channel.send(pingCard({ kind: "warn", ...part, allowedMentions: { users } }));
        if (!first) first = posted;
        messageIds.push(String(posted.id));
    }
    return { channelId: channel.id, messageId: first.id, messageIds, url: first.url };
}

/**
 * Bring a posted ping (postMissingPing's messages) to another list of users,
 * split the same way. An edit notifies nobody (and `allowedMentions` parses
 * nothing to be sure) — the list is only kept true. A chunk more than before is
 * posted quietly, a message left over is deleted; a message somebody deleted in
 * Discord stays deleted (its share is moved on to the next message). A ping
 * posted as plain text before the cards turns into the card on its next edit.
 * @returns {Promise<{ messageIds: string[] }>} the messages the ping consists of now
 */
async function editPingMessages(channelId, messageIds = [], userIds = [], text = "") {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    const body = String(text || "").trim();
    const payloads = pingParts(users, body).map((part) => pingCard({ kind: "warn", ...part, allowedMentions: { parse: [] } }));
    // the messages still there, in order
    const messages = [];
    for (const id of (messageIds || []).map(String)) {
        try {
            messages.push(await channel.messages.fetch(id));
        } catch (e) {
            if (!/unknown message/i.test((e && e.message) || "") && Number(e && e.code) !== 10008) throw e;
        }
    }
    // the whole ping deleted by hand: it stays gone
    if (!messages.length) return { messageIds: [] };
    const kept = [];
    for (let i = 0; i < payloads.length; i++) {
        if (messages[i]) {
            await messages[i].edit(payloads[i]);
            kept.push(String(messages[i].id));
        } else {
            const posted = await channel.send(payloads[i]);
            kept.push(String(posted.id));
        }
    }
    for (const left of messages.slice(payloads.length)) await left.delete().catch(() => {});
    return { messageIds: kept };
}


/**
 * A message that pings nobody, as one card (utils/discord/card.js): a `<@id>` in it shows the name without a notification.
 * `payload` is plain text (the card's text), or `{ content?, embeds? }` — an embed (a raw object or a builder, as elsewhere in
 * this file) becomes the card (cardFromEmbed), `content` its text.
 * @returns {Promise<{ channelId, messageId, url }>}
 */
async function postNotice(channelId, payload) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const data = typeof payload === "string" ? { content: payload } : (payload || {});
    const first = Array.isArray(data.embeds) && data.embeds[0] ? data.embeds[0] : null;
    const embed = first && typeof first.toJSON === "function" ? first.toJSON() : first;
    const text = data.content ? String(data.content) : "";
    const send = embed
        ? cardFromEmbed({ ...embed, description: [text, embed.description || ""].filter(Boolean).join("\n\n") })
        : card({ text });
    const posted = await channel.send(send);
    return { channelId: channel.id, messageId: posted.id, url: posted.url };
}

/**
 * Post a whole message (`{ content?, embeds?, components? }`) that pings
 * nobody — a panel with buttons, say.
 * @returns {Promise<{ guildId, channelId, messageId, url }>}
 */
async function postPayload(channelId, payload) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url };
}

/** Replace a bot message's content in place (postPayload's counterpart). */
async function editPayload(channelId, messageId, payload) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden.");
    const message = await channel.messages.fetch(String(messageId));
    if (message.author.id !== client.user.id) throw new Error("Diese Nachricht stammt nicht vom Bot.");
    await message.edit({ ...payload, allowedMentions: { parse: [] } });
    return { guildId: channel.guildId, channelId: channel.id, messageId: message.id, url: message.url };
}

/**
 * Whether the bot sees a text channel it may post in (from the cache, no
 * request): false for a deleted channel, one of a server the bot left, one it
 * lost the rights for — and while the bot is offline.
 */
function channelVisible(channelId) {
    if (!client || !client.channels || !client.channels.cache) return false;
    const channel = client.channels.cache.get(String(channelId || ""));
    if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) return false;
    const me = channel.guild && channel.guild.members ? channel.guild.members.me : null;
    if (!me || typeof channel.permissionsFor !== "function") return true;
    const perms = channel.permissionsFor(me);
    return !!perms && perms.has(PermissionsBitField.Flags.ViewChannel) && perms.has(PermissionsBitField.Flags.SendMessages);
}

/** Join mentions with spaces into strings of at most `max` characters (at least one mention each). */
function mentionChunks(mentions, max) {
    const limit = Math.max(Number(max) || 0, 100);
    const out = [];
    let cur = "";
    for (const m of mentions) {
        if (cur && cur.length + 1 + m.length > limit) {
            out.push(cur);
            cur = m;
        } else {
            cur = cur ? `${cur} ${m}` : m;
        }
    }
    if (cur) out.push(cur);
    return out;
}

/**
 * Custom emojis of a guild, for the emoji picker. Returns the Discord code
 * (`<:name:id>` / `<a:name:id>`) that has to be typed into a message, plus the
 * image URL for the picker preview.
 */
function listEmojis(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    return [...guild.emojis.cache.values()]
        .filter((e) => e.available !== false)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .map((e) => ({
            id: e.id,
            name: e.name || "",
            animated: !!e.animated,
            code: `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
            url: typeof e.imageURL === "function" ? e.imageURL({ size: 64 }) : e.url,
        }));
}

/** Text channels of a guild the bot can post in, for channel dropdowns. */
function listTextChannels(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    const me = guild.members.me;
    return [...guild.channels.cache.values()]
        .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
        .filter((c) => !me || c.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages))
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map((c) => ({ id: c.id, name: c.name, category: c.parent ? c.parent.name : "", parentId: c.parentId || "" }));
}

/**
 * Voice (and stage) channels of a guild — the picker for the raid's voice
 * channel (#305). Unlike listTextChannels() nothing is filtered by the bot's
 * rights: the bot never speaks there, it only names the channel.
 */
function listVoiceChannels(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    return [...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map((c) => ({ id: c.id, name: c.name, category: c.parent ? c.parent.name : "", parentId: c.parentId || "" }));
}

/**
 * Whether the bot may manage this server's scheduled events (#305).
 * `null` when nothing can be known — the bot is not on that server or not
 * connected yet — which must never read as "the right is missing".
 */
function botCanManageEvents(guildId) {
    const guild = getGuild(guildId);
    const me = guild && guild.members ? guild.members.me : null;
    if (!guild || !me || !me.permissions) return null;
    return me.permissions.has(PermissionsBitField.Flags.ManageEvents);
}

/** Category channels of a guild, for the "create in category" dropdown. */
function listCategories(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    return [...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Whether the bot may see / post in a channel. Without a resolved own member
 * (bot not fully connected) nothing is known, and "unknown" must not read as a
 * missing right — the same stance listTextChannels() takes.
 */
function botRights(channel, me) {
    if (!me || typeof channel.permissionsFor !== "function") return { botCanView: true, botCanSend: true };
    const perms = channel.permissionsFor(me);
    if (!perms) return { botCanView: false, botCanSend: false };
    const botCanView = perms.has(PermissionsBitField.Flags.ViewChannel);
    return { botCanView, botCanSend: botCanView && perms.has(PermissionsBitField.Flags.SendMessages) };
}

/**
 * All non-category channels of a guild, for the Kanäle page. Each carries its
 * type label, its parent category, whether it is a thread (its parentId then
 * names the text channel it hangs off, not a category — #361), and whether the
 * bot may see and post there (botCanView / botCanSend), so the page can warn
 * before something fails to arrive.
 */
function listAllChannels(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    const me = guild.members ? guild.members.me : null;
    return [...guild.channels.cache.values()]
        .filter((c) => c.type !== ChannelType.GuildCategory)
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            typeLabel: CHANNEL_TYPE_LABELS[c.type] || "Kanal",
            category: c.parent ? c.parent.name : "",
            parentId: c.parentId || "",
            isThread: THREAD_TYPES.includes(c.type),
            ...botRights(c, me),
        }));
}

/**
 * Create a new channel in a guild.
 * @param {string} guildId
 * @param {{name:string, type?:string, parentId?:string}} opts type is a key of
 *   CREATABLE_CHANNEL_TYPES (default "text"); parentId is an optional category.
 * @returns {Promise<{id, name}>}
 */
async function createChannel(guildId, opts = {}) {
    const guild = getGuild(guildId);
    if (!guild) throw new Error("Server nicht gefunden oder Bot nicht verbunden.");
    const name = String(opts.name || "").trim();
    if (!name) throw new Error("Kanalname fehlt.");
    const type = CREATABLE_CHANNEL_TYPES[opts.type] ?? ChannelType.GuildText;
    const payload = { name, type };
    if (opts.parentId) payload.parent = opts.parentId;
    const created = await guild.channels.create(payload);
    return { id: created.id, name: created.name };
}

/**
 * Duplicate a channel: a full clone (permissions, topic, slowmode, type, …) in
 * the SAME category as the original, with an editable new name.
 * @param {string} channelId source channel
 * @param {string} newName   name for the clone (defaults to the original's)
 * @returns {Promise<{id, name}>}
 */
async function duplicateChannel(channelId, newName) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const source = await client.channels.fetch(channelId);
    if (!source || typeof source.clone !== "function") {
        throw new Error("Quell-Kanal nicht gefunden oder nicht duplizierbar.");
    }
    const name = String(newName || source.name || "").trim();
    // clone() copies parent, permission overwrites, topic, nsfw, slowmode, etc.
    const cloned = await source.clone(name ? { name } : undefined);
    return { id: cloned.id, name: cloned.name };
}

/**
 * A recruitment message from a template: one card (utils/discord/card.js) with the template's text (emojis and all) and the
 * apply button inside it. Editing an older text or embed post turns it into the card (`content: ""`, `embeds: []`).
 */
function buildRecruitmentMessage(template) {
    const apply = new ButtonBuilder()
        .setCustomId(applyButtonId(template.versionId))
        .setLabel(template.buttonLabel || "Jetzt bewerben")
        .setStyle(ButtonStyle.Success);
    return card({ text: template.content || "", buttons: [apply] });
}

/** Post a recruitment template to a channel. Returns { guildId, channelId, messageId, url }. */
async function postRecruitment(channelId, template) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send(buildRecruitmentMessage(template));
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url };
}

/** Edit an already-posted recruitment message in place. */
async function editRecruitment(channelId, messageId, template) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden.");
    const message = await channel.messages.fetch(messageId);
    if (message.author.id !== client.user.id) throw new Error("Diese Nachricht stammt nicht vom Bot.");
    await message.edit(buildRecruitmentMessage(template));
    return { channelId, messageId, url: message.url };
}

/** Try to delete a posted message (best-effort). */
async function deleteMessage(channelId, messageId) {
    if (!client) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        return true;
    } catch {
        return false;
    }
}

/**
 * Every component of a message, nested ones included: a card (Components V2) holds its text, its sections and its button rows
 * inside a container, an older message has its rows on top. Each item is a discord.js component or its API JSON.
 */
function allComponents(list) {
    const out = [];
    for (const c of list || []) {
        if (!c) continue;
        out.push(c);
        out.push(...allComponents(c.components));
        if (c.accessory) out.push(c.accessory);
    }
    return out;
}

const customIdOf = (comp) => comp.customId || comp.custom_id || (comp.data && comp.data.custom_id) || "";

function isRecruitmentMessage(msg) {
    if (!client || msg.author.id !== client.user.id) return false;
    return allComponents(msg.components).some((comp) => isApplyButtonId(customIdOf(comp)));
}

function extractTemplate(msg) {
    const embed = msg.embeds && msg.embeds[0];
    let buttonLabel = "";
    let versionId = "";
    const all = allComponents(msg.components);
    for (const comp of all) {
        if (isApplyButtonId(customIdOf(comp))) {
            buttonLabel = comp.label || (comp.data && comp.data.label) || "";
            versionId = versionOfApplyButton(customIdOf(comp));
        }
    }
    // a card keeps the template's text in its text display (type 10), an older post in `content`
    const cardText = all.filter((c) => (c.type === 10 || (c.data && c.data.type === 10)) && (c.content || (c.data && c.data.content)))
        .map((c) => c.content || c.data.content).join("\n");
    return {
        content: msg.content || cardText || "",
        title: (embed && embed.title) || "",
        body: (embed && embed.description) || "",
        buttonLabel,
        versionId,
    };
}

/**
 * Scan a guild's text channels for bot-posted recruitment messages (with the
 * apply button). Returns candidates: { guildId, channelId, channelName, messageId, url, title, body, buttonLabel }.
 */
async function scanRecruitment(guildId, { perChannel = 50 } = {}) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    const me = guild.members.me;
    const found = [];
    const channels = [...guild.channels.cache.values()]
        .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
        .filter((c) => !me || c.permissionsFor(me).has(PermissionsBitField.Flags.ViewChannel));
    for (const channel of channels) {
        try {
            const messages = await channel.messages.fetch({ limit: perChannel });
            for (const msg of messages.values()) {
                if (!isRecruitmentMessage(msg)) continue;
                found.push({
                    guildId,
                    channelId: channel.id,
                    channelName: channel.name,
                    messageId: msg.id,
                    url: msg.url,
                    ...extractTemplate(msg),
                });
            }
        } catch {
            // no access / rate-limited on this channel — skip
        }
    }
    return found;
}

// Strip Discord custom-emoji markup (<:name:id> / <a:name:id>) so the class/spec
// value from an application embed reads as plain text in the web menu.
function stripEmojiMarkup(value) {
    return String(value || "").replace(/<a?:\w+:\d+>/g, "").replace(/\s+/g, " ").trim();
}

// The field that identifies the bot's application embed (see applyModal.js).
function isApplicationField(name) {
    return String(name || "").toLowerCase().startsWith("bewerber");
}

function embedHasApplicantField(embed) {
    return (embed.fields || []).some((f) => isApplicationField(f.name));
}

/**
 * Parse the bot's application embed (built in commands/apply/applyModal.js) into
 * the structured fields the admin menu lists. Field names are matched by prefix
 * so the "(automatisch ermittelt)" suffix on auto-filled links still matches.
 */
function parseApplicationEmbed(embed) {
    const out = {
        applicantId: "", displayName: "", character: "",
        classSpec: "", armory: "", wcl: "", description: "",
        discordName: "", date: "",
        // The game version (#553): the embed's "Version" field, TBC for one from before.
        versionId: versionOfFieldValue(""),
    };
    if (!embed) return out;
    const titleMatch = String(embed.title || "").match(/^Neue Bewerbung von (.+)$/);
    if (titleMatch) out.displayName = titleMatch[1].trim();
    for (const f of embed.fields || []) {
        const name = String(f.name || "").toLowerCase();
        const value = f.value || "";
        if (isApplicationField(name)) {
            const m = value.match(/<@!?(\d+)>/);
            out.applicantId = m ? m[1] : "";
        } else if (name.startsWith("charakter")) {
            out.character = value.trim();
        } else if (name.startsWith("klasse")) {
            out.classSpec = stripEmojiMarkup(value);
        } else if (name.startsWith("armory")) {
            out.armory = value.trim();
        } else if (name.startsWith("warcraftlogs")) {
            out.wcl = value.trim();
        } else if (name.startsWith("über")) {
            out.description = value.trim();
        } else if (name === VERSION_FIELD.toLowerCase()) {
            out.versionId = versionOfFieldValue(value);
        }
    }
    const footerMatch = String((embed.footer && embed.footer.text) || "").match(/Discord:\s*(.+?)\s*\|\s*(.+)$/);
    if (footerMatch) {
        out.discordName = footerMatch[1].trim();
        out.date = footerMatch[2].trim();
    }
    return out;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * List the applications posted as threads in the application channel. Each thread
 * is created by the /apply flow (commands/apply/applyModal.js) and carries a bot
 * embed with the applicant's character, class/spec, armory + logs links and
 * description. Reads active and archived threads, keeps only the most recent ones
 * (at most `limit`, and none older than `maxAgeWeeks`), then parses each first
 * embed. Returns the applications (newest first) plus an error string when the
 * channel is missing/unreadable so the UI can degrade gracefully.
 *
 * Age + count are applied BEFORE fetching each thread's messages, so at most
 * `limit` message fetches hit Discord regardless of how many threads exist.
 * @returns {Promise<{ applications: object[], error: string|null }>}
 */
async function listApplications(channelId, { limit = 10, maxAgeWeeks = 6, archivedLimit = 100 } = {}) {
    if (!client) return { applications: [], error: "Bot nicht verbunden." };
    if (!channelId) return { applications: [], error: null };
    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch {
        return { applications: [], error: "Bewerbungs-Channel nicht gefunden (ID prüfen)." };
    }
    if (!channel || !channel.threads || typeof channel.threads.fetchActive !== "function") {
        return { applications: [], error: "Der konfigurierte Bewerbungs-Channel unterstützt keine Threads." };
    }

    // Collect active + archived threads, deduped by id (active wins).
    const threads = new Map();
    try {
        const active = await channel.threads.fetchActive();
        for (const t of active.threads.values()) threads.set(t.id, { thread: t, archived: false });
    } catch { /* keep going with whatever we can read */ }
    try {
        const archived = await channel.threads.fetchArchived({ limit: archivedLimit });
        for (const t of archived.threads.values()) {
            if (!threads.has(t.id)) threads.set(t.id, { thread: t, archived: true });
        }
    } catch { /* archived may be inaccessible — ignore */ }

    // Keep only recent threads, newest first, capped to `limit` — done before the
    // per-thread message fetch so we never load more than we show.
    const cutoff = Date.now() - (maxAgeWeeks * WEEK_MS);
    const selected = [...threads.values()]
        .filter(({ thread }) => (thread.createdTimestamp || 0) >= cutoff)
        .sort((a, b) => (b.thread.createdTimestamp || 0) - (a.thread.createdTimestamp || 0))
        .slice(0, limit);

    const applications = [];
    for (const { thread, archived } of selected) {
        let details = parseApplicationEmbed(null);
        try {
            const messages = await thread.messages.fetch({ limit: 10 });
            // fetch() returns newest-first; the application embed is the oldest match.
            const appMsg = [...messages.values()].reverse()
                .find((m) => (m.embeds || []).some(embedHasApplicantField));
            const embed = appMsg && appMsg.embeds.find(embedHasApplicantField);
            if (embed) details = parseApplicationEmbed(embed);
        } catch { /* thread unreadable — list it with its name only */ }
        applications.push({
            threadId: thread.id,
            name: thread.name || "",
            // discord.js builds the jump link of the thread it just fetched (#537: no hand-built channel links)
            url: thread.url || "",
            createdAt: thread.createdTimestamp || 0,
            archived,
            ...details,
        });
    }
    return { applications, error: null };
}

// The two analyses offered under a detected log. Kept here (rather than imported)
// so the Discord layer stays free of the analysis modules.
const LOG_SECTIONS = [
    { key: "cla", label: "CLA auswerten", emoji: "🛡️", done: "CLA", what: "Gear, Verzauberungen, Sockel, Consumables, Drums, Potions & Shadow-Resi" },
    { key: "rpb", label: "RPB auswerten", emoji: "💥", done: "RPB", what: "vermeidbarer Schaden, Tode, Aktivität, Cooldowns, Interrupts & Log-Prüfung" },
];

/**
 * Build the button row for a detected log, leaving out the analyses that already
 * ran. Returns an empty array once both are done.
 */
function logButtonRow(logId, doneSections = []) {
    const open = LOG_SECTIONS.filter((s) => !doneSections.includes(s.key));
    if (!open.length) return [];
    return [new ActionRowBuilder().addComponents(
        ...open.map((s) => new ButtonBuilder()
            .setCustomId(`${LOG_EVAL_PREFIX}:${logId}:${s.key}`)
            .setLabel(s.label)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(s.emoji)),
    )];
}

// The embed's colour bar shows how far the log is: open (orange), half (blurple), done (green).
const LOG_COLORS = { open: 0xe8a33d, half: 0x5865f2, done: 0x23a55a };
const LOG_HEADS = { open: "Warcraft-Logs-Report erkannt", half: "Log-Auswertung läuft", done: "Log vollständig ausgewertet" };

/** "So 04.10." in server time (the guild's), "" without a start. */
function logDayText(startMs) {
    const ms = Number(startMs) || 0;
    if (!ms) return "";
    const dt = DateTime.fromMillis(ms, { zone: TIMEZONE }).setLocale("de");
    return `${dt.toFormat("ccc").replace(/\.$/, "")} ${dt.toFormat("dd.MM.")}`;
}

/**
 * The embed under a detected log (a checklist): head by progress, the report's name as
 * the title (linked to Warcraft Logs), "So 04.10. · 1 von 2 ausgewertet", one line per
 * analysis — an open one says what it checks, a finished one is ticked and links the
 * evaluation — and while nothing ran yet a footer how it works. Pure.
 *
 * @param {{ title?: string, link?: string, startMs?: number, doneSections?: string[], reportUrl?: string }} opts
 */
function logButtonEmbed({ title = "", link = "", startMs = 0, doneSections = [], reportUrl = "" } = {}) {
    const done = LOG_SECTIONS.filter((s) => doneSections.includes(s.key));
    const state = !done.length ? "open" : done.length < LOG_SECTIONS.length ? "half" : "done";
    const sub = [logDayText(startMs), `${done.length} von ${LOG_SECTIONS.length} ausgewertet`].filter(Boolean).join(" · ");
    const lines = LOG_SECTIONS.map((s) => (doneSections.includes(s.key)
        ? `✅ **${s.done}** – ausgewertet${reportUrl ? ` · [öffnen](${reportUrl})` : ""}`
        : `⚪ **${s.done}** – ${s.what}`));
    return buildEmbed({
        title: String(title || "").trim() || "Warcraft-Logs-Report",
        url: /^https:\/\//.test(String(link || "")) ? link : undefined,
        description: [sub, "", ...lines].join("\n"),
        color: LOG_COLORS[state],
        footer: state === "open" ? "Ein Klick startet die Auswertung · beide landen auf derselben Seite" : "",
        author: LOG_HEADS[state],
    });
}

/** The whole message under a detected log: the embed, the open analyses' buttons and the evaluation's link. */
function logButtonPayload({ logId, title, link, startMs, doneSections = [], reportUrl = "" } = {}) {
    const components = logId ? logButtonRow(logId, doneSections) : [];
    if (reportUrl) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Auswertung öffnen").setStyle(ButtonStyle.Link).setURL(reportUrl)));
    }
    return { content: "", embeds: [logButtonEmbed({ title, link, startMs, doneSections, reportUrl })], components };
}

/**
 * Post the CLA/RPB evaluation buttons as a reply under a detected log message.
 * @param {import("discord.js").Message} message the message that contained the log link
 * @param {object} opts { logId, title, link, startMs, doneSections }
 * @returns {Promise<{channelId: string, messageId: string}>}
 */
async function postLogButton(message, opts = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const sent = await message.reply({ ...logButtonPayload(opts), allowedMentions: { repliedUser: false } });
    return { channelId: sent.channelId, messageId: sent.id };
}

/**
 * Update a previously-posted log button message: after one half was evaluated (the
 * finished analysis loses its button and gains a link, the other one stays
 * clickable), or when the report's name and date arrived after the detection. A
 * message from before the embed (plain text) becomes the embed. Best-effort —
 * returns false on error.
 *
 * @param {object} opts { reportUrl, title, link, startMs, logId, doneSections }
 */
async function finishLogButton(channelId, messageId, opts = {}) {
    if (!client || !channelId || !messageId) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);
        await message.edit(logButtonPayload(opts));
        return true;
    } catch (e) {
        console.error("finishLogButton failed:", e.message);
        return false;
    }
}

/**
 * A raid plan / raidsheet / softres link message: ONE raid card (utils/discord/card.js, Oct 2026) — the raid's name small over
 * the heading, the orga's optional message, the facts (the start, short), the link button inside the card, in the event's
 * colour. Before it was plain `content` with an emoji heading, because text plus embed showed as two stacked blocks; a card
 * is one block. The card carries `content: ""` and `embeds: []`, so editing an older text post turns it into the card.
 */
function buildLinkMessage({ url, title, kicker, message, facts, color, label = "Öffnen" } = {}) {
    // Without a url (a withdrawn share, #537) the message keeps its text and loses the button.
    const button = url ? new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url) : null;
    return card({
        kind: "raid", color, kicker, title, text: String(message || "").trim(), facts, buttons: button ? [button] : [],
    });
}

/**
 * Post a raidsheet / softres link into a channel, optionally preceded by a
 * custom message. Used by the event-detail "in Channel posten" buttons.
 * @param {string} channelId target text channel
 * @param {object} opts { url, title, message, label, emoji }
 * @returns {Promise<{channelId: string, messageId: string, url: string}>}
 */
async function postLink(channelId, opts = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    if (!opts.url) throw new Error("Kein Link vorhanden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send(buildLinkMessage(opts));
    return { channelId: channel.id, messageId: posted.id, url: posted.url };
}

/** Edit an already-posted raidsheet/softres link message in place; without `url` the button goes. */
async function editLink(channelId, messageId, opts = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden.");
    const message = await channel.messages.fetch(messageId);
    if (message.author.id !== client.user.id) throw new Error("Diese Nachricht stammt nicht vom Bot.");
    await message.edit(buildLinkMessage(opts));
    return { channelId, messageId, url: message.url };
}

/**
 * How long a name lookup waits for the gateway. Without the privileged members
 * intent (a dev bot, docs/known-issues.md) Discord never answers a member
 * request by id, and discord.js' own limit is two minutes — a page asking for
 * names (Abwesenheiten) would hang that long and then show the bare ids anyway.
 */
const NAME_FETCH_MS = 5000;

/**
 * Display names for a set of user ids, best-effort.
 *
 * Used for the per-account permission grants (config.userPermissions, a
 * handful of ids — a raw 18-digit id in a rights list tells an admin nothing)
 * and for the setup editor's GET (up to a full raid's worth of raiders, #353's
 * follow-up). Cache hits are free; everything else goes in **one** bulk
 * member fetch (needs `GatewayIntentBits.GuildMembers`, already on for this
 * bot) instead of a fetch per id — that was one Discord round trip per raider
 * on every Setup-tab load. An id that cannot be resolved (left the server,
 * bot offline, no access) simply has no entry, and the page falls back to
 * showing the id.
 *
 * @returns {Promise<Record<string, string>>} id -> display name
 */
async function resolveUserNames(guildId, userIds = []) {
    const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
    const guild = getGuild(guildId);
    if (!guild || !ids.length) return {};
    const out = {};
    const missing = [];
    for (const id of ids) {
        const cached = guild.members.cache.get(id);
        if (cached) out[id] = cached.displayName || cached.user.username;
        else missing.push(id);
    }
    if (missing.length) {
        try {
            const fetched = await guild.members.fetch({ user: missing, time: NAME_FETCH_MS });
            for (const member of fetched.values()) out[member.id] = member.displayName || member.user.username;
        } catch {
            // Unknown members / no access — those ids stay out, the page shows the bare id.
        }
    }
    return out;
}

/**
 * The role ids one member holds on a server, for "which raid categories may
 * this member see" (Anmeldungen, #256). A single-member fetch, no privileged
 * intent. Null when it cannot be known — bot offline, not a member, Discord
 * unreachable — so the caller can tell "no roles" from "unknown".
 * @returns {Promise<string[]|null>}
 */
async function memberRoleIds(guildId, userId) {
    const guild = getGuild(guildId);
    if (!guild || !userId) return null;
    try {
        const member = guild.members.cache.get(String(userId)) || await guild.members.fetch(String(userId));
        const cache = member && member.roles && member.roles.cache;
        return cache && typeof cache.keys === "function" ? [...cache.keys()] : null;
    } catch {
        return null;
    }
}

/**
 * Send a direct message to one Discord user. A single-user fetch needs no
 * privileged intent (see resolveUserNames). Fails when the user closed their
 * DMs or blocked the bot — that is reported, never retried.
 *
 * @param {string} userId
 * @param {object} payload  discord.js message payload ({ content, embeds, components })
 * @returns {Promise<{ ok: true, messageId: string } | { ok: false, error: string }>}
 */
async function sendDirectMessage(userId, payload) {
    if (!client) throw new Error("Bot nicht verbunden.");
    try {
        const user = await client.users.fetch(String(userId));
        if (!user) return { ok: false, error: "Nutzer nicht gefunden." };
        const sent = await user.send(payload);
        return { ok: true, messageId: sent && sent.id ? String(sent.id) : "" };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

/** An embed in the bot's colours; the caller fills title, description and fields. */
function embed() {
    return new EmbedBuilder().setColor(embedAccentColor);
}

module.exports = {
    setClient, getClient, isOnline, fetchTextChannel, textChannelOf, listGuilds, getGuild, listTextChannels, listEmojis,
    sendDirectMessage, embed,
    resolveUserNames, NAME_FETCH_MS,
    memberRoleIds,
    listCategories, listAllChannels, listVoiceChannels, botCanManageEvents, createChannel, duplicateChannel,
    listRoles, getChannelCategoryMap, postAnnouncement,
    listMembersWithRoles, listHumanMembers, postMissingPing, editPingMessages, postNotice, channelVisible, mentionChunks, _resetMembersCacheForTests,
    fetchGuildMembersCached, botPermissionsIn, REQUIRED_BOT_PERMISSIONS,
    postRecruitment, editRecruitment, deleteMessage, scanRecruitment,
    isRecruitmentMessage, extractTemplate,
    listApplications, parseApplicationEmbed,
    postLogButton, finishLogButton, LOG_EVAL_PREFIX,
    LOG_SECTIONS, logButtonRow, logButtonEmbed, logButtonPayload, logDayText,
    postLink, editLink, postPayload, editPayload,
};
