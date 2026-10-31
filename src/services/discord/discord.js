// Bridge between the web admin menu and the Discord bot client: list servers /
// channels, and post / edit / scan recruitment messages. The client is injected
// from the web server startup (which receives it from bot.js). This is the one
// holder of the client: everything else (auth included) reads it via getClient().

const {
    ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionsBitField,
} = require("discord.js");
const { embedAccentColor } = require("../../config/variables");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { buildEmbed } = require("../../utils/discord/reply");
const { card, cardFromEmbed } = require("../../utils/discord/card");
const { silentMentionSteps, mentionEdit } = require("../../utils/discord/mentionName");
const logger = require("../../logger").child("discord");

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

/**
 * The bot fetches any channel it sees, across servers (#924): a channel set for
 * one server must not take another server's posts. Throws code "wrong_guild"
 * when `guildId` is given and the channel lives elsewhere; no `guildId`, no check.
 */
function assertChannelGuild(channel, guildId = "") {
    const want = String(guildId || "").trim();
    if (!want || String((channel && channel.guildId) || "") === want) return;
    throw Object.assign(new Error("Kanal liegt auf einem anderen Server."), { code: "wrong_guild" });
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
        .map((g) => ({ id: g.id, name: g.name || "" })) // an unavailable server (outage) has no name
        .sort((a, b) => a.name.localeCompare(b.name));
}

function getGuild(guildId) {
    return client && guildId ? client.guilds.cache.get(guildId) : null;
}

/** A server's own icon from Discord's CDN, "" when it has none or the bot does not know it. */
function guildIconUrl(guildId) {
    const guild = getGuild(guildId);
    if (!guild || typeof guild.iconURL !== "function") return "";
    try {
        return guild.iconURL({ size: 64 }) || "";
    } catch {
        return "";
    }
}

/**
 * Whether the bot has a server cached AND usable (#926). During a Discord
 * outage discord.js v14 keeps a server in the cache with `available === false`
 * and no channels — being cached proves nothing about its channels then.
 */
function isGuildAvailable(guildId) {
    const guild = getGuild(guildId);
    return !!guild && guild.available !== false;
}

/** Roles of a guild that can be pinged (excludes @everyone), highest first. */
function listRoles(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    return [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id) // drop @everyone
        .sort((a, b) => (b.rawPosition || 0) - (a.rawPosition || 0))
        // color: the role's hex colour, "" for an uncoloured role — the
        // permission matrix tints a role's tile with it. managed: a role a bot or
        // an integration owns (@MEE6, a booster role) — nobody can be given it, so
        // the role pickers of the menu leave it out (#745).
        .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : "", managed: r.managed === true }));
}

/**
 * Where role ids live (#925): looks each id up in the role cache of EVERY
 * server the bot is on, not only the configured ones. A full admin role is
 * global, so a server page shows it as "role · its server" instead of
 * "unknown". Ids found nowhere (deleted role, bot not on that server) are
 * missing from the result. @everyone counts as no role.
 * @param {string[]} roleIds
 * @returns {Record<string, { id: string, name: string, color: string, guildId: string, guildName: string }>}
 */
function findRolesAnywhere(roleIds) {
    const wanted = new Set((Array.isArray(roleIds) ? roleIds : []).map(String).filter(Boolean));
    const out = {};
    if (!client || !wanted.size) return out;
    for (const guild of client.guilds.cache.values()) {
        const cache = guild && guild.roles && guild.roles.cache;
        if (!cache || typeof cache.get !== "function") continue;
        for (const id of wanted) {
            if (out[id] || id === guild.id) continue;
            const r = cache.get(id);
            if (!r) continue;
            out[id] = { id, name: r.name || "", color: r.color ? r.hexColor : "", guildId: guild.id, guildName: guild.name || "" };
        }
    }
    return out;
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
    // Single members can be mentioned next to the roles (a role mention only
    // works on the role's own server, see pingDelivery.js).
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
// the admin got a 504 and nothing was ever posted. So the fetched list is kept
// per guild — the ping then pings exactly the roster the page just showed — and
// served stale-while-revalidate:
//   - younger than MEMBERS_CACHE_TTL_MS: served as it is;
//   - older, but younger than MEMBERS_STALE_MAX_MS: served at once, and ONE
//     refresh starts in the background (a page never waits on Discord for it);
//   - older than that, or nothing there yet: the caller waits for a fetch.
// Fetches are shared per guild: parallel callers (the cold first fetch
// included) wait on the same promise, so a burst of requests costs one fetch.
// A failed fetch is never cached; a failed background refresh keeps the old list.
//
// How old the data really is: the GuildMember objects in the list are the ones
// in discord.js' own member cache, which the GuildMembers intent keeps current —
// a role change patches them in place (GUILD_MEMBER_UPDATE). What the list can
// miss until the next refresh is who joined or left the server: at most
// MEMBERS_STALE_MAX_MS, in practice the time since the last read, and the two
// role-sync jobs (roleSync, rosterRoleSync) fetch with { fresh: true } every
// 10 minutes. Serving guild.members.cache itself instead was considered and
// left out: after a reconnect, or without the intent, it silently holds a
// partial list, and nothing tells a partial list from a complete one.
const MEMBERS_CACHE_TTL_MS = 60_000;
const MEMBERS_STALE_MAX_MS = 30 * 60_000;
// Cap the fetch itself too — discord.js waits 120s by default, which is already
// twice the proxy's patience.
const MEMBERS_FETCH_TIMEOUT_MS = 25_000;
const membersCache = new Map(); // guildId -> { at, members: Array<GuildMember> }
const membersInFlight = new Map(); // guildId -> Promise<Array<GuildMember>>

/** Test-only: drop the member cache. Production code never calls this. */
function _resetMembersCacheForTests() {
    membersCache.clear();
    membersInFlight.clear();
}

/** One full fetch of a guild's members into the cache; a fetch already running is joined, not repeated. */
function refreshGuildMembers(guildId, guild) {
    const running = membersInFlight.get(guildId);
    if (running) return running;
    const fetching = (async () => {
        const fetched = await guild.members.fetch({ time: MEMBERS_FETCH_TIMEOUT_MS });
        const members = [...fetched.values()];
        membersCache.set(guildId, { at: Date.now(), members });
        return members;
    })();
    membersInFlight.set(guildId, fetching);
    const done = () => {
        if (membersInFlight.get(guildId) === fetching) membersInFlight.delete(guildId);
    };
    fetching.then(done, done);
    return fetching;
}

/**
 * All members of a guild, stale-while-revalidate (see above). Throws whatever
 * the fetch throws (missing GuildMembers intent, timeout) when the caller has
 * to wait for one — a failure is never cached.
 * @param {{ fresh?: boolean }} [opts] `fresh` waits for a list fetched now (or
 *   joins the fetch already running): for the background jobs that write roles
 *   from the list, never for a page.
 */
async function fetchGuildMembersCached(guildId, guild, { fresh = false } = {}) {
    const key = String(guildId);
    const cached = membersCache.get(key);
    const age = cached ? Date.now() - cached.at : Infinity;
    if (!fresh && age < MEMBERS_CACHE_TTL_MS) return cached.members;
    if (!fresh && age < MEMBERS_STALE_MAX_MS) {
        refreshGuildMembers(key, guild).catch((e) => {
            logger.warn(`member list refresh of ${key} failed, keeping the list from ${Math.round(age / 1000)} s ago:`, (e && e.message) || e);
        });
        return cached.members;
    }
    return refreshGuildMembers(key, guild);
}

/**
 * Fetch the member lists of these guilds in the background (bot ready), so the
 * first page after a restart does not wait for them. Never rejects; a guild the
 * bot is not on is skipped. Returns the promise for the tests.
 */
function warmGuildMembers(guildIds = []) {
    const ids = [...new Set((guildIds || []).map(String).filter(Boolean))];
    return Promise.all(ids.map(async (id) => {
        const guild = getGuild(id);
        if (!guild) return;
        try {
            await refreshGuildMembers(id, guild);
        } catch (e) {
            logger.warn(`member list warm-up of ${id} failed:`, (e && e.message) || e);
        }
    }));
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
        let posted;
        try {
            posted = await channel.send(pingCard({ kind: "warn", ...part, allowedMentions: { users } }));
        } catch (e) {
            // A later chunk failed: the earlier ones did ping — the caller may count that.
            if (messageIds.length && e && typeof e === "object") e.sentMessageIds = messageIds.slice();
            throw e;
        }
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
 * `guildId`: only post when the channel lives on that server (assertChannelGuild).
 * @returns {Promise<{ channelId, messageId, url }>}
 */
async function postNotice(channelId, payload, { guildId = "" } = {}) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    assertChannelGuild(channel, guildId);
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
 * nobody — a panel with buttons, say. `guildId`: only post when the channel
 * lives on that server (assertChannelGuild). `silentMentions`: a card that shows raiders by `<@id>` — goes through
 * utils/discord/mentionName.silentMentionSteps (post, then the edit that lets Discord resolve the names; nothing more
 * while SILENT_MENTION_EDIT is off). A failed follow-up edit only logs: the card is out.
 * @returns {Promise<{ guildId, channelId, messageId, url }>}
 */
async function postPayload(channelId, payload, { guildId = "", silentMentions = false } = {}) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    assertChannelGuild(channel, guildId);
    const steps = silentMentions ? silentMentionSteps(payload) : { first: { ...payload, allowedMentions: { parse: [] } }, then: null };
    const posted = await channel.send(steps.first);
    if (steps.then) {
        try {
            await posted.edit(steps.then);
        } catch (e) {
            logger.warn(`silent mention edit of ${posted.id} failed:`, (e && e.message) || e);
        }
    }
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url };
}

/**
 * Post a plain text message that pings exactly one role (`allowedMentions` limited to it);
 * link previews are suppressed.
 * @returns {Promise<{ guildId, channelId, messageId, url }>}
 */
async function postRolePing(channelId, roleId, content) {
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send({ content, allowedMentions: { parse: [], roles: [String(roleId)] }, flags: MessageFlags.SuppressEmbeds });
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url };
}

/**
 * Replace a bot message's content in place (postPayload's counterpart). `silentMentions`: keep the names a card posted
 * with `silentMentions` shows (mentionName.mentionEdit — an edit never pings).
 */
async function editPayload(channelId, messageId, payload, { silentMentions = false } = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden.");
    const message = await channel.messages.fetch(String(messageId));
    if (message.author.id !== client.user.id) throw new Error("Diese Nachricht stammt nicht vom Bot.");
    await message.edit(silentMentions ? mentionEdit(payload) : { ...payload, allowedMentions: { parse: [] } });
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
 * Where a recruitment post may go: the text channels of listTextChannels() plus the forums in which the bot may open a post
 * (SendMessages and SendMessagesInThreads). `kind` tells the dialog which is which — a forum post needs a title.
 */
function listRecruitmentTargets(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    const me = guild.members.me;
    const may = (c, flags) => !me || flags.every((f) => c.permissionsFor(me).has(f));
    const { SendMessages, SendMessagesInThreads } = PermissionsBitField.Flags;
    return [...guild.channels.cache.values()]
        .filter((c) => (TEXT_CHANNEL_TYPES.includes(c.type) && may(c, [SendMessages]))
            || (c.type === ChannelType.GuildForum && may(c, [SendMessages, SendMessagesInThreads])))
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map((c) => ({
            id: c.id, name: c.name, category: c.parent ? c.parent.name : "", parentId: c.parentId || "",
            kind: c.type === ChannelType.GuildForum ? "forum" : "text",
        }));
}

/**
 * Channels of a guild an invite may lead into (text and announcement channels), with whether the bot may create one
 * there (`canInvite`) — a missing right shows in the dialog instead of failing on the click. Only channels @everyone may
 * see: a newcomer lands there, an invite into a hidden channel shows them nothing.
 */
function listInviteChannels(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    const me = guild.members.me;
    const everyone = guild.roles && guild.roles.everyone;
    const publicView = (c) => {
        if (!everyone || typeof c.permissionsFor !== "function") return true;
        const perms = c.permissionsFor(everyone);
        return !!perms && perms.has(PermissionsBitField.Flags.ViewChannel);
    };
    return [...guild.channels.cache.values()]
        .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
        .filter(publicView)
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map((c) => ({
            id: c.id, name: c.name, category: c.parent ? c.parent.name : "",
            canInvite: !me || c.permissionsFor(me).has(PermissionsBitField.Flags.CreateInstantInvite),
        }));
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

// The hidden mark of a recruitment card: the container's component id (Components V2 lets every component carry an
// integer id, which Discord never shows). A link button alone says nothing - other bot messages have link buttons too
// (PuG invites, raid plans) - so "Server durchsuchen" knows a link post only by this mark.
const RECRUITMENT_MARK = 7291;

/**
 * Put the hidden recruitment mark on a card payload (its container). Through setId(): discord.js sends a builder's
 * `data` (toJSON), so a plain `.id` on the builder would never reach Discord.
 */
function markRecruitment(payload) {
    const container = payload.components && payload.components[0];
    if (container && typeof container.setId === "function") container.setId(RECRUITMENT_MARK);
    else if (container) container.id = RECRUITMENT_MARK;
    return payload;
}

/** Whether a message carries the recruitment mark (discord.js component or API JSON). */
const hasRecruitmentMark = (msg) => (msg.components || [])
    .some((c) => c && (c.id === RECRUITMENT_MARK || (c.data && c.data.id === RECRUITMENT_MARK)));

/**
 * A recruitment message from a template: one card (utils/discord/card.js) with the template's text (emojis and all) and the
 * apply button inside it. Editing an older text or embed post turns it into the card (`content: ""`, `embeds: []`).
 */
function buildRecruitmentMessage(template) {
    if (template.buttonKind === "link") {
        // a link button (an invite to the guild's server) instead of the apply flow — the URL is checked by the route
        const link = new ButtonBuilder()
            .setURL(template.linkUrl)
            .setLabel(template.buttonLabel || "Server beitreten")
            .setStyle(ButtonStyle.Link);
        return markRecruitment(card({ text: template.content || "", buttons: [link] }));
    }
    const apply = new ButtonBuilder()
        .setCustomId(applyButtonId(template.versionId))
        .setLabel(template.buttonLabel || "Jetzt bewerben")
        .setStyle(ButtonStyle.Success);
    return markRecruitment(card({ text: template.content || "", buttons: [apply] }));
}

// A forum post's title: Discord takes at most 100 characters.
const FORUM_TITLE_MAX = 100;
// cut by code points, never inside an emoji's surrogate pair
const forumTitleOf = (value) => Array.from(String(value || "").trim()).slice(0, FORUM_TITLE_MAX).join("");

/**
 * Post a recruitment template to a channel. Returns { guildId, channelId, messageId, url, parentChannelId }.
 * A forum gets a new post (a thread) titled `template.forumTitle` with the card as its starter message; then channelId is
 * the thread and messageId the starter message — the same id — so editing and deleting work as for a channel post.
 */
async function postRecruitment(channelId, template) {
    if (!client) throw Object.assign(new Error("Bot nicht verbunden."), { code: "bot_offline" });
    const target = await client.channels.fetch(String(channelId || "")).catch(() => null);
    if (target && target.type === ChannelType.GuildForum) {
        const name = forumTitleOf(template.forumTitle);
        if (!name) throw Object.assign(new Error("Ein Forum-Beitrag braucht einen Titel."), { code: "title_required" });
        const thread = await target.threads.create({ name, message: buildRecruitmentMessage(template), reason: "Recruitment-Beitrag" });
        return { guildId: target.guildId, channelId: thread.id, messageId: thread.id, parentChannelId: target.id, url: thread.url || "" };
    }
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send(buildRecruitmentMessage(template));
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url, parentChannelId: "" };
}

// Renaming a thread is limited to 2 per 10 minutes; on the 429 discord.js would wait silently for minutes. A rename of a
// recruitment post fails fast instead: while its channel id is in this set, the REST manager rejects its rate limit.
const renamingChannels = new Set();
const guardedRests = new WeakSet();
const RENAME_TIMEOUT_MS = 10000;
// Discord's codes for an edit in an archived (50083) or locked (160005) thread
const THREAD_CLOSED_CODES = [50083, 160005];

/** Hook the scoped "reject this rate limit" check into the client's REST manager, keeping any option set before. */
function guardRenameRateLimit(c) {
    const rest = c && c.rest;
    if (!rest || !rest.options || guardedRests.has(rest)) return;
    guardedRests.add(rest);
    const previous = rest.options.rejectOnRateLimit;
    rest.options.rejectOnRateLimit = async (data) => {
        const url = String((data && data.url) || "").split("?")[0];
        if ([...renamingChannels].some((id) => url.endsWith(`/channels/${id}`))) return true;
        if (typeof previous === "function") return previous(data);
        return Array.isArray(previous) && previous.some((route) => String((data && data.route) || "").startsWith(route.toLowerCase()));
    };
}

const isRateLimitError = (e) => !!e && (String(e.name || "").startsWith("RateLimitError") || e.code === "rename_timeout");

/**
 * Rename a recruitment thread without hanging: a rate limit or no answer within RENAME_TIMEOUT_MS gives
 * "title_rate_limited", any other failure "title_failed"; "" when the title is set.
 */
async function renameThread(channel, name) {
    guardRenameRateLimit(client);
    renamingChannels.add(channel.id);
    let timer = null;
    const renaming = channel.setName(name, "Recruitment-Beitrag bearbeitet");
    renaming.catch(() => {});
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("rename timeout"), { code: "rename_timeout" })), RENAME_TIMEOUT_MS);
    });
    try {
        await Promise.race([renaming, timeout]);
        return "";
    } catch (e) {
        if (isRateLimitError(e)) return "title_rate_limited";
        logger.warn(`Recruitment: Titel von ${channel.id} nicht geändert: ${e && e.message}`);
        return "title_failed";
    } finally {
        clearTimeout(timer);
        renamingChannels.delete(channel.id);
    }
}

/** Whether the bot may reopen a locked thread (Threads verwalten). Unknown rights count as allowed - Discord decides. */
function mayManageThread(channel) {
    const me = channel.guild && channel.guild.members && channel.guild.members.me;
    const perms = me && typeof channel.permissionsFor === "function" ? channel.permissionsFor(me) : null;
    return !perms || perms.has(PermissionsBitField.Flags.ManageThreads);
}

/** Edit the message; an archived thread is reopened once and the edit tried again, a locked one needs Threads verwalten. */
async function editInThread(channel, message, payload) {
    try {
        await message.edit(payload);
        return;
    } catch (e) {
        const isThread = typeof channel.isThread === "function" && channel.isThread();
        if (!isThread || !THREAD_CLOSED_CODES.includes(e && e.code)) throw e;
    }
    if (channel.locked && !mayManageThread(channel)) {
        throw Object.assign(new Error("Der Forum-Beitrag ist gesperrt. Gib dem Bot dort das Recht „Threads verwalten“ oder entsperre den Beitrag in Discord."),
            { code: "thread_locked" });
    }
    if (channel.archived) await channel.setArchived(false, "Recruitment-Beitrag bearbeitet");
    await message.edit(payload);
}

/**
 * Edit an already-posted recruitment message in place. The text comes first: a quiet forum post (archived by Discord) is
 * reopened for it. Then a forum post is renamed when `template.forumTitle` differs from its title - that may be refused for
 * a while (2 renames per 10 minutes), which does not undo the text: `notice` then says "title_rate_limited" (or
 * "title_failed"), "" when everything went through.
 */
async function editRecruitment(channelId, messageId, template) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await fetchTextChannel(channelId, "Channel nicht gefunden.");
    const message = await channel.messages.fetch(messageId);
    if (message.author.id !== client.user.id) throw new Error("Diese Nachricht stammt nicht vom Bot.");
    await editInThread(channel, message, buildRecruitmentMessage(template));
    let notice = "";
    if (typeof channel.isThread === "function" && channel.isThread()) {
        const name = forumTitleOf(template.forumTitle);
        if (name && name !== channel.name) notice = await renameThread(channel, name);
    }
    return { channelId, messageId, url: message.url, notice };
}

/**
 * A permanent invite the bot made earlier into this channel (never expires, no use limit), or null. Listing the invites
 * needs "Kanäle verwalten"; without it nothing is reused.
 */
async function ownPermanentInvite(channel) {
    if (typeof channel.fetchInvites !== "function") return null;
    const invites = await channel.fetchInvites().catch(() => null);
    if (!invites) return null;
    const botId = client && client.user ? client.user.id : "";
    return [...invites.values()].find((i) => !i.maxAge && !i.maxUses && !i.temporary
        && botId && (i.inviterId || (i.inviter && i.inviter.id)) === botId) || null;
}

/**
 * A permanent invite into `channelId` for a recruitment link button: never expires, no use limit (the pattern of
 * pugInvites.ensureInvite). The bot's own permanent invite there is reused, so every click does not leave a new one -
 * `fresh` makes a new one anyway ("Neu erzeugen"). `reused` says which happened. Throws code "invite_permission" when the
 * bot lacks "Einladung erstellen" there.
 */
async function createRecruitmentInvite(channelId, reason = "Recruitment-Link", { fresh = false } = {}) {
    const channel = await fetchTextChannel(channelId, "Kanal nicht gefunden.");
    const me = channel.guild && channel.guild.members && channel.guild.members.me;
    const perms = me && typeof channel.permissionsFor === "function" ? channel.permissionsFor(me) : null;
    if (perms && !perms.has(PermissionsBitField.Flags.CreateInstantInvite)) {
        throw Object.assign(new Error("Dem Bot fehlt dort das Recht „Einladung erstellen“. Gib das Recht frei oder füge einen Link selbst ein."),
            { code: "invite_permission" });
    }
    const known = fresh ? null : await ownPermanentInvite(channel);
    if (known) return { code: known.code, url: known.url || `https://discord.gg/${known.code}`, reused: true };
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason });
    return { code: invite.code, url: invite.url || `https://discord.gg/${invite.code}`, reused: false };
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

/** A bot message with the apply button, or one with the recruitment mark (a link post has no apply button). */
function isRecruitmentMessage(msg) {
    if (!client || !msg || !msg.author || msg.author.id !== client.user.id) return false;
    return hasRecruitmentMark(msg) || allComponents(msg.components).some((comp) => isApplyButtonId(customIdOf(comp)));
}

const LINK_STYLE = 5;
const propOf = (comp, key) => comp[key] || (comp.data && comp.data[key]) || "";

function extractTemplate(msg) {
    const embed = msg.embeds && msg.embeds[0];
    let buttonLabel = "";
    let versionId = "";
    let linkUrl = "";
    const all = allComponents(msg.components);
    for (const comp of all) {
        if (isApplyButtonId(customIdOf(comp))) {
            buttonLabel = propOf(comp, "label");
            versionId = versionOfApplyButton(customIdOf(comp));
        }
    }
    // a marked card without an apply button is a link post: its link button's URL and label
    const link = !buttonLabel && hasRecruitmentMark(msg)
        ? all.find((comp) => propOf(comp, "style") === LINK_STYLE && propOf(comp, "url")) : null;
    if (link) {
        buttonLabel = propOf(link, "label");
        linkUrl = propOf(link, "url");
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
        buttonKind: linkUrl ? "link" : "apply",
        linkUrl: linkUrl || "",
    };
}

/**
 * The recruitment posts the bot opened in the guild's forums: the active threads (one call for the whole guild) and
 * each forum's archived ones (at most `archivedLimit`), only threads the bot started, newest first and at most
 * `maxThreads` - so at most that many starter messages are fetched (the server has one vCPU).
 */
async function scanForumPosts(guild, forums, { archivedLimit = 50, maxThreads = 50 } = {}) {
    if (!forums.length) return [];
    const forumOf = new Map(forums.map((f) => [f.id, f]));
    const threads = new Map();
    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    for (const t of active ? active.threads.values() : []) if (forumOf.has(t.parentId)) threads.set(t.id, t);
    for (const forum of forums) {
        const archived = await forum.threads.fetchArchived({ limit: archivedLimit }).catch(() => null);
        for (const t of archived ? archived.threads.values() : []) if (!threads.has(t.id)) threads.set(t.id, t);
    }
    const botId = client.user && client.user.id;
    const own = [...threads.values()]
        .filter((t) => botId && t.ownerId === botId)
        .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0))
        .slice(0, maxThreads);
    const found = [];
    for (const thread of own) {
        const msg = await thread.fetchStarterMessage().catch(() => null);
        if (!msg || !isRecruitmentMessage(msg)) continue;
        const forum = forumOf.get(thread.parentId);
        found.push({
            guildId: guild.id,
            channelId: thread.id,
            channelName: forum.name,
            messageId: msg.id,
            url: msg.url,
            parentChannelId: forum.id,
            forumTitle: thread.name,
            ...extractTemplate(msg),
        });
    }
    return found;
}

/**
 * Scan a guild for bot-posted recruitment messages: the last `perChannel` messages of each text channel and the posts
 * the bot opened in its forums (scanForumPosts). A message counts with the apply button or the recruitment mark (a
 * link post). Returns candidates: { guildId, channelId, channelName, messageId, url, title, body, buttonLabel,
 * buttonKind, linkUrl }, a forum post also with parentChannelId and forumTitle.
 */
async function scanRecruitment(guildId, { perChannel = 50, archivedLimit = 50, maxThreads = 50 } = {}) {
    const guild = getGuild(guildId);
    if (!guild) return [];
    const me = guild.members.me;
    const found = [];
    // type first: a thread in the cache whose parent is not can answer permissionsFor() with null
    const channels = [...guild.channels.cache.values()]
        .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type) || c.type === ChannelType.GuildForum)
        .filter((c) => {
            if (!me) return true;
            const perms = c.permissionsFor(me);
            return !!perms && perms.has(PermissionsBitField.Flags.ViewChannel);
        });
    const forums = channels.filter((c) => c.type === ChannelType.GuildForum);
    for (const channel of channels.filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))) {
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
    found.push(...await scanForumPosts(guild, forums, { archivedLimit, maxThreads }));
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
 * Whether a message of the bot under a log belongs to that log: one of its
 * buttons carries the log id, or its embed (or an old plain text) links the
 * report — a post with two links has two replies pointing at the same post.
 */
function isLogButtonOf(message, { logId = "", link = "" } = {}) {
    const ids = (message.components || []).flatMap((row) => (row.components || []).map((c) => String(c.customId || "")));
    if (logId && ids.some((id) => id.startsWith(`${LOG_EVAL_PREFIX}:${logId}:`) || id === `${LOG_EVAL_PREFIX}:${logId}`)) return true;
    if (!link) return false;
    return (message.embeds || []).some((e) => e && e.url === link) || String(message.content || "").includes(link);
}

/**
 * The bot's own reply under a detected log message that belongs to the log
 * (`isLogButtonOf`): `{ channelId, messageId }`, or null. For logs whose button
 * message was never recorded (before the ids were stored correctly) or is gone —
 * looks at the messages right after the log post. Best-effort, never throws.
 *
 * @param {{ logId?: string, link?: string }} [of] the log the reply must belong to
 */
async function findLogButtonMessage(channelId, sourceMessageId, of = {}) {
    if (!client || !client.user || !channelId || !sourceMessageId) return null;
    try {
        const channel = await client.channels.fetch(channelId);
        const after = await channel.messages.fetch({ after: sourceMessageId, limit: 50 });
        const hit = [...after.values()].find((m) => m.author && m.author.id === client.user.id
            && m.reference && m.reference.messageId === sourceMessageId && isLogButtonOf(m, of));
        return hit ? { channelId: hit.channelId || channelId, messageId: hit.id } : null;
    } catch (e) {
        console.error("findLogButtonMessage failed:", e.message);
        return null;
    }
}

/** Whether a message still exists (false on any error — a gone one or no answer). */
async function logButtonExists(channelId, messageId) {
    if (!client || !channelId || !messageId) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        return !!(await channel.messages.fetch(messageId));
    } catch {
        return false;
    }
}

/**
 * A raid plan / raidsheet / softres link message: ONE raid card (utils/discord/card.js, Oct 2026) — the raid's name small over
 * the heading, the orga's optional message, the facts (the start, short), the link button inside the card, in the event's
 * colour. Before it was plain `content` with an emoji heading, because text plus embed showed as two stacked blocks; a card
 * is one block. The card carries `content: ""` and `embeds: []`, so editing an older text post turns it into the card.
 */
function buildLinkMessage({ url, title, kicker, message, facts, color, label = "Öffnen", lines, thumbnail, note, buttons } = {}) {
    // Without a url (a withdrawn share, #537) the message keeps its text and loses the button.
    const button = url ? new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url) : null;
    // `lines`: short lines above the orga's message (the softres instances, the planned bosses); `buttons`: more
    // buttons after the link (softres "Wer fehlt?"); `thumbnail`/`note` as in card().
    const text = [...(Array.isArray(lines) ? lines : []), message].map((l) => String(l || "").trim()).filter(Boolean);
    const extra = Array.isArray(buttons) ? buttons : [];
    return card({
        kind: "raid", color, kicker, title, text, facts, thumbnail, note, buttons: [...(button ? [button] : []), ...extra],
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
 * How long an id Discord did not hand back is left out of the next lookups.
 * A raider who left the server (or signed up from another one) is never in the
 * member cache, so without this every page listing them asked Discord again —
 * and waited for it — on every load. A lookup that failed outright (timeout,
 * rate limit) is not a "no", so it is only skipped for the shorter time.
 */
const ABSENT_MS = 30 * 60 * 1000;
const FAILED_MS = 5 * 60 * 1000;
const absentUntil = new Map(); // "<guildId>:<userId>" -> ms timestamp

/** Resolves with null after `ms`, without keeping the process alive. */
function nullAfter(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        if (timer.unref) timer.unref();
    });
}

/**
 * The Discord picture of a user id from the bot's cache, no fetch: the guild member's (server avatar first),
 * else the account's, "" while the bot knows neither — the web shows the initial then.
 */
function avatarUrlFor(guildId, userId) {
    const id = String(userId || "");
    if (!client || !id) return "";
    const member = getGuild(guildId)?.members?.cache?.get(id);
    if (member) return avatarUrlOf(member) || "";
    const account = client.users?.cache?.get(id);
    if (!account || typeof account.displayAvatarURL !== "function") return "";
    try {
        return account.displayAvatarURL({ size: 64 }) || "";
    } catch {
        return "";
    }
}

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
 * showing the id; it is not asked for again for a while (ABSENT_MS).
 *
 * `waitMs` caps how long the caller waits (the create dialog must not stand
 * still for Discord): the fetch goes on in the background and fills the
 * member cache, so the names are there on the next call.
 *
 * @param {{ waitMs?: number }} [opts]
 * @returns {Promise<Record<string, string>>} id -> display name
 */
async function resolveUserNames(guildId, userIds = [], { waitMs = NAME_FETCH_MS } = {}) {
    const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
    const guild = getGuild(guildId);
    if (!guild || !ids.length) return {};
    const out = {};
    const missing = [];
    const now = Date.now();
    const keyOf = (id) => `${guildId}:${id}`;
    for (const id of ids) {
        const cached = guild.members.cache.get(id);
        if (cached) out[id] = cached.displayName || cached.user.username;
        else if (!(absentUntil.get(keyOf(id)) > now)) missing.push(id);
    }
    if (!missing.length) return out;
    const fetching = Promise.resolve()
        .then(() => guild.members.fetch({ user: missing, time: NAME_FETCH_MS }))
        .then((fetched) => {
            const until = Date.now() + ABSENT_MS;
            for (const id of missing) if (!fetched.has(id)) absentUntil.set(keyOf(id), until);
            return fetched;
        }, () => {
            // Unknown members / no access / timeout — those ids stay out, the page shows the bare id.
            const until = Date.now() + FAILED_MS;
            for (const id of missing) absentUntil.set(keyOf(id), until);
            return null;
        });
    const fetched = waitMs < NAME_FETCH_MS ? await Promise.race([fetching, nullAfter(Math.max(0, waitMs))]) : await fetching;
    if (fetched) for (const member of fetched.values()) out[member.id] = member.displayName || member.user.username;
    return out;
}

// Test-only: forget which ids Discord did not know.
function _resetAbsentNamesForTests() {
    absentUntil.clear();
}

/**
 * The role ids one member holds on a server, for "which raid categories may
 * this member see" (Anmeldungen, #256). A single-member fetch, no privileged
 * intent. Null when it cannot be known — bot offline, not a member, Discord
 * unreachable — so the caller can tell "no roles" from "unknown".
 * `absentAs` is what to answer when Discord says the member is surely not on
 * the server (Unknown Member/User) — a signup check passes [] so "not a member"
 * needs no second fetch (#904); by default that stays null like every failure.
 * @returns {Promise<string[]|null>}
 */
async function memberRoleIds(guildId, userId, { absentAs = null } = {}) {
    const guild = getGuild(guildId);
    if (!guild || !userId) return null;
    try {
        const member = guild.members.cache.get(String(userId)) || await guild.members.fetch(String(userId));
        const cache = member && member.roles && member.roles.cache;
        return cache && typeof cache.keys === "function" ? [...cache.keys()] : null;
    } catch (e) {
        const code = e && (e.code || (e.rawError && e.rawError.code));
        return code === 10007 || code === 10013 ? absentAs : null;
    }
}

/**
 * Whether a user is a member of a server (#907: the web signup of a PuG raid):
 * true / false, or null when it cannot be known — bot offline, the server not
 * reachable, Discord answering with anything but "Unknown Member/User". Only a
 * definite "not a member" is false, so a Discord hiccup never refuses anybody.
 * It runs on page requests, so it waits at most `waitMs` (NAME_FETCH_MS) and
 * answers null after that - the fetch is not awaited any further.
 * @param {{ waitMs?: number }} [opts]
 * @returns {Promise<boolean|null>}
 */
async function guildMembership(guildId, userId, { waitMs = NAME_FETCH_MS } = {}) {
    const guild = getGuild(guildId);
    if (!guild || !userId) return null;
    const uid = String(userId);
    if (guild.members.cache.get(uid)) return true;
    const lookup = Promise.resolve()
        .then(() => guild.members.fetch(uid))
        .then((member) => (member ? true : null), (e) => {
            const code = e && (e.code || (e.rawError && e.rawError.code));
            if (code === 10007 || code === 10013) return false;
            logger.warn(`membership lookup of ${uid} on ${guildId} failed:`, (e && e.message) || e);
            return null;
        });
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(0, waitMs));
        if (timer.unref) timer.unref();
    });
    try {
        return await Promise.race([lookup, timeout]);
    } finally {
        clearTimeout(timer);
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
    setClient, getClient, isOnline, fetchTextChannel, textChannelOf, listGuilds, getGuild, guildIconUrl, isGuildAvailable, listTextChannels, listEmojis,
    sendDirectMessage, embed,
    resolveUserNames, avatarUrlFor, avatarUrlOf, NAME_FETCH_MS, ABSENT_MS, _resetAbsentNamesForTests,
    memberRoleIds, guildMembership,
    listCategories, listAllChannels, listVoiceChannels, botCanManageEvents, createChannel, duplicateChannel,
    listRoles, findRolesAnywhere, getChannelCategoryMap, postAnnouncement,
    listMembersWithRoles, listHumanMembers, postMissingPing, editPingMessages, postNotice, channelVisible, mentionChunks, _resetMembersCacheForTests,
    fetchGuildMembersCached, warmGuildMembers, MEMBERS_CACHE_TTL_MS, MEMBERS_STALE_MAX_MS, botPermissionsIn, REQUIRED_BOT_PERMISSIONS,
    postRecruitment, editRecruitment, deleteMessage, scanRecruitment,
    listRecruitmentTargets, listInviteChannels, createRecruitmentInvite, buildRecruitmentMessage,
    isRecruitmentMessage, extractTemplate,
    listApplications, parseApplicationEmbed,
    postLogButton, finishLogButton, findLogButtonMessage, logButtonExists, LOG_EVAL_PREFIX,
    LOG_SECTIONS, logButtonRow, logButtonEmbed, logButtonPayload, logDayText,
    postLink, editLink, postPayload, postRolePing, editPayload,
};
