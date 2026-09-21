// Bridge between the web admin menu and the Discord bot client: list servers /
// channels, and post / edit / scan recruitment messages. The client is injected
// from the web server startup (which receives it from bot.js).

const {
    ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField,
} = require("discord.js");
const { embedAccentColor } = require("../config/variables");

let client = null;
function setClient(c) {
    client = c;
}
function getClient() {
    return client;
}

const RECRUIT_BUTTON_ID = "apply";
// Button under a detected log; customId carries the tracked log id after the ":".
const LOG_EVAL_PREFIX = "logcheck-eval";
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

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
 * Post a sign-up announcement into a channel, pinging the given roles.
 * The message body comes from a notify template (title/body → embed); the role
 * mentions live in the plain content so they actually ping.
 * @returns { guildId, channelId, messageId, url }
 */
async function postAnnouncement(channelId, template, roleIds = [], userIds = []) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");

    const roles = (roleIds || []).filter(Boolean);
    // Single members are mentioned where a role cannot be: on the talk server
    // an event-server role means nothing (see pingDelivery.js).
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    const mentions = [...roles.map((id) => `<@&${id}>`), ...users.map((id) => `<@${id}>`)].join(" ");
    const payload = { allowedMentions: users.length ? { roles, users } : { roles } };

    if (template.title || template.body) {
        const embed = new EmbedBuilder().setColor(embedAccentColor);
        if (template.title) embed.setTitle(template.title);
        if (template.body) embed.setDescription(template.body);
        payload.embeds = [embed];
        payload.content = mentions || undefined;
    } else {
        // no embed → put everything in the message content
        payload.content = [mentions, template.body || ""].filter(Boolean).join("\n") || mentions;
    }
    if (!payload.content && (!payload.embeds || !payload.embeds.length)) {
        throw new Error("Nachricht ist leer — Vorlage oder Rollen wählen.");
    }

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

/**
 * Ping the given users in a channel, asking them to sign up or off for an event.
 * The mentions live in the plain content so they actually notify; allowedMentions
 * is scoped to exactly those users.
 * @returns {Promise<{ channelId, messageId, url }>}
 */
async function postMissingPing(channelId, userIds = [], text = "") {
    if (!client) throw new Error("Bot nicht verbunden.");
    const users = [...new Set((userIds || []).map(String).filter(Boolean))];
    if (!users.length) throw new Error("Keine fehlenden Raider zum Pingen.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    const body = String(text || "").trim()
        || "Bitte meldet euch für den Raid an oder ab, damit die Aufstellung vollständig ist.";
    // Discord refuses a message over 2000 characters, and a mention costs about
    // 22 — a roster of ~90 missing raiders would otherwise post nothing at all.
    // The mentions are split over as many messages as needed, the text rides
    // on the last one.
    const chunks = mentionChunks(users.map((id) => `<@${id}>`), MESSAGE_LIMIT - body.length - 1);
    let first = null;
    for (let i = 0; i < chunks.length; i++) {
        const last = i === chunks.length - 1;
        const posted = await channel.send({
            content: last ? `${chunks[i]}\n${body}` : chunks[i],
            allowedMentions: { users },
        });
        if (!first) first = posted;
    }
    return { channelId: channel.id, messageId: first.id, url: first.url };
}

const MESSAGE_LIMIT = 2000;

/**
 * A plain message that pings nobody: a `<@id>` in it shows the name without a
 * notification (allowedMentions parses nothing). Cut to Discord's 2000.
 * @returns {Promise<{ channelId, messageId, url }>}
 */
async function postNotice(channelId, content) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(String(channelId || ""));
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send({ content: String(content || "").slice(0, MESSAGE_LIMIT), allowedMentions: { parse: [] } });
    return { channelId: channel.id, messageId: posted.id, url: posted.url };
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
 * type label, its parent category, and whether the bot may see and post there
 * (botCanView / botCanSend), so the page can warn before something fails to arrive.
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
 * Build a recruitment message payload from a template: plain message text
 * (`content`, where emojis usually live) plus the apply button. No embed —
 * `embeds: []` also clears any embed a message still had from before this
 * was the case (e.g. one added by hand in Discord).
 */
function buildRecruitmentMessage(template) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(RECRUIT_BUTTON_ID)
            .setLabel(template.buttonLabel || "Jetzt bewerben")
            .setStyle(ButtonStyle.Success)
    );
    return { content: template.content || "", embeds: [], components: [row] };
}

/** Post a recruitment template to a channel. Returns { guildId, channelId, messageId, url }. */
async function postRecruitment(channelId, template) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send(buildRecruitmentMessage(template));
    return { guildId: channel.guildId, channelId: channel.id, messageId: posted.id, url: posted.url };
}

/** Edit an already-posted recruitment message in place. */
async function editRecruitment(channelId, messageId, template) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden.");
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

function isRecruitmentMessage(msg) {
    if (!client || msg.author.id !== client.user.id) return false;
    return (msg.components || []).some((row) =>
        (row.components || []).some((comp) => comp.customId === RECRUIT_BUTTON_ID));
}

function extractTemplate(msg) {
    const embed = msg.embeds && msg.embeds[0];
    let buttonLabel = "";
    for (const row of msg.components || []) {
        for (const comp of row.components || []) {
            if (comp.customId === RECRUIT_BUTTON_ID) buttonLabel = comp.label || "";
        }
    }
    return {
        content: msg.content || "",
        title: (embed && embed.title) || "",
        body: (embed && embed.description) || "",
        buttonLabel,
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
            url: `https://discord.com/channels/${thread.guildId}/${thread.id}`,
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

/** The message body under a detected log, describing what each button does. */
function logButtonContent(title, doneSections = [], reportUrl = "") {
    const open = LOG_SECTIONS.filter((s) => !doneSections.includes(s.key));
    const done = LOG_SECTIONS.filter((s) => doneSections.includes(s.key));

    if (!open.length) {
        return `✅ **Vollständig ausgewertet**${title ? ` – ${title}` : ""}`
            + `\nCLA und RPB liegen vor${reportUrl ? " — beide auf derselben Seite" : ""}.`;
    }

    const head = done.length
        ? `✅ **${done.map((s) => s.done).join(" & ")} ausgewertet**${title ? ` – ${title}` : ""}`
        : `📊 **Warcraft-Logs-Report erkannt**${title ? ` – ${title}` : ""}`;
    const lines = open.map((s) => `**${s.label}** → ${s.what}`);
    const hint = done.length
        ? "\nDie zweite Auswertung landet auf derselben Seite."
        : "";
    return `${head}\n${lines.join("\n")}${hint}`;
}

/**
 * Post the CLA/RPB evaluation buttons as a reply under a detected log message.
 * @param {import("discord.js").Message} message the message that contained the log link
 * @param {object} opts { logId, title, doneSections }
 * @returns {Promise<{channelId: string, messageId: string}>}
 */
async function postLogButton(message, { logId, title, doneSections = [] } = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const sent = await message.reply({
        content: logButtonContent(title, doneSections),
        components: logButtonRow(logId, doneSections),
        allowedMentions: { repliedUser: false },
    });
    return { channelId: sent.channelId, messageId: sent.id };
}

/**
 * Update a previously-posted log button message after one half was evaluated:
 * the finished analysis loses its button and gains a link, the other one stays
 * clickable. Best-effort — returns false on error.
 *
 * @param {object} opts { reportUrl, title, logId, doneSections }
 */
async function finishLogButton(channelId, messageId, { reportUrl, title, logId, doneSections = [] } = {}) {
    if (!client || !channelId || !messageId) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);

        const components = logId ? logButtonRow(logId, doneSections) : [];
        if (reportUrl) {
            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Auswertung öffnen").setStyle(ButtonStyle.Link).setURL(reportUrl));
            components.push(linkRow);
        }
        await message.edit({
            content: logButtonContent(title, doneSections, reportUrl),
            components,
        });
        return true;
    } catch (e) {
        console.error("finishLogButton failed:", e.message);
        return false;
    }
}

/**
 * Build a raidsheet/softres link message payload: plain message text
 * (`content`, heading with emoji+title followed by the optional custom
 * message) plus a link button. No embed — mirrors `buildRecruitmentMessage`,
 * which dropped the embed for exactly the same reason (Discord otherwise
 * renders `content` and the embed as two stacked blocks in one message,
 * reading as a duplicate post). `embeds: []` also clears any embed a message
 * still had from before this was the case.
 */
function buildLinkMessage({ url, title, message, label = "Öffnen", emoji = "📄" } = {}) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url)
    );
    const heading = title ? `${emoji} **${title}**` : "";
    const text = String(message || "").trim();
    const content = [heading, text].filter(Boolean).join("\n");
    return { content, embeds: [], components: [row] };
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
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    const posted = await channel.send(buildLinkMessage(opts));
    return { channelId: channel.id, messageId: posted.id, url: posted.url };
}

/** Edit an already-posted raidsheet/softres link message in place. */
async function editLink(channelId, messageId, opts = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    if (!opts.url) throw new Error("Kein Link vorhanden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden.");
    const message = await channel.messages.fetch(messageId);
    if (message.author.id !== client.user.id) throw new Error("Diese Nachricht stammt nicht vom Bot.");
    await message.edit(buildLinkMessage(opts));
    return { channelId, messageId, url: message.url };
}

/**
 * Display names for a handful of user ids, best-effort.
 *
 * For the per-account permission grants (config.userPermissions): a raw 18-digit
 * id in a rights list tells an admin nothing, so the settings page shows the
 * name next to it. Fetched one by one rather than through the member cache,
 * because this is a few ids and a single-member fetch needs no privileged
 * intent — an id that cannot be resolved (left the server, bot offline) simply
 * has no entry, and the page falls back to showing the id.
 *
 * @returns {Promise<Record<string, string>>} id -> display name
 */
async function resolveUserNames(guildId, userIds = []) {
    const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
    const guild = getGuild(guildId);
    if (!guild || !ids.length) return {};
    const out = {};
    await Promise.all(ids.map(async (id) => {
        try {
            const member = guild.members.cache.get(id) || await guild.members.fetch(id);
            if (member) out[id] = member.displayName || member.user.username;
        } catch {
            // Unknown member / no access — the page shows the bare id.
        }
    }));
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
    setClient, getClient, listGuilds, getGuild, listTextChannels, listEmojis,
    sendDirectMessage, embed,
    resolveUserNames,
    memberRoleIds,
    listCategories, listAllChannels, listVoiceChannels, botCanManageEvents, createChannel, duplicateChannel,
    listRoles, getChannelCategoryMap, postAnnouncement,
    listMembersWithRoles, postMissingPing, postNotice, channelVisible, mentionChunks, _resetMembersCacheForTests,
    fetchGuildMembersCached, botPermissionsIn, REQUIRED_BOT_PERMISSIONS,
    postRecruitment, editRecruitment, deleteMessage, scanRecruitment,
    isRecruitmentMessage, extractTemplate,
    listApplications, parseApplicationEmbed,
    postLogButton, finishLogButton, LOG_EVAL_PREFIX,
    LOG_SECTIONS, logButtonRow, logButtonContent,
    postLink, editLink,
};
