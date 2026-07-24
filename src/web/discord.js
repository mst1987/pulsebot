// Bridge between the web admin menu and the Discord bot client: list servers /
// channels, and post / edit / scan recruitment messages. The client is injected
// from the web server startup (which receives it from bot.js).

const {
    ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField,
} = require("discord.js");

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
        .map((r) => ({ id: r.id, name: r.name }));
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
async function postAnnouncement(channelId, template, roleIds = []) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");

    const roles = (roleIds || []).filter(Boolean);
    const mentions = roles.map((id) => `<@&${id}>`).join(" ");
    const payload = { allowedMentions: { roles } };

    if (template.title || template.body) {
        const embed = new EmbedBuilder().setColor(0x5865F2);
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
        const all = await guild.members.fetch();
        const members = [...all.values()]
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
    const mentions = users.map((id) => `<@${id}>`).join(" ");
    const body = String(text || "").trim()
        || "Bitte meldet euch für den Raid an oder ab, damit die Aufstellung vollständig ist.";
    const posted = await channel.send({
        content: `${mentions}\n${body}`,
        allowedMentions: { users },
    });
    return { channelId: channel.id, messageId: posted.id, url: posted.url };
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
        .map((c) => ({ id: c.id, name: c.name, category: c.parent ? c.parent.name : "" }));
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
 * All non-category channels of a guild, for the "duplicate this channel"
 * dropdown. Each carries its type label and parent category so the UI can show
 * where a clone would land.
 */
function listAllChannels(guildId) {
    const guild = getGuild(guildId);
    if (!guild) return [];
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
 * Build a recruitment message payload from a template. Faithfully round-trips
 * both the plain message text (`content`, where emojis usually live) and an
 * optional embed (title + description), plus the apply button.
 */
function buildRecruitmentMessage(template) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(RECRUIT_BUTTON_ID)
            .setLabel(template.buttonLabel || "Jetzt bewerben")
            .setStyle(ButtonStyle.Success)
    );
    const payload = { content: template.content || "", components: [row] };
    if (template.title || template.body) {
        const embed = new EmbedBuilder().setColor(0x5865F2);
        if (template.title) embed.setTitle(template.title);
        if (template.body) embed.setDescription(template.body);
        payload.embeds = [embed];
    } else {
        // no embed → clear any existing one when editing (message keeps its content)
        payload.embeds = [];
    }
    return payload;
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

/**
 * Post a "Log auswerten" button as a reply under a detected log message.
 * @param {import("discord.js").Message} message the message that contained the log link
 * @param {object} opts { logId, title }
 * @returns {Promise<{channelId: string, messageId: string}>}
 */
async function postLogButton(message, { logId, title } = {}) {
    if (!client) throw new Error("Bot nicht verbunden.");
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${LOG_EVAL_PREFIX}:${logId}`)
            .setLabel("Log auswerten")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("📊")
    );
    const content = `📊 **Warcraft-Logs-Report erkannt**${title ? ` – ${title}` : ""}.\n`
        + "Klicke auf **Log auswerten**, um Gear, Consumables, Drums, Potions & Shadow-Resi zu prüfen.";
    const sent = await message.reply({ content, components: [row], allowedMentions: { repliedUser: false } });
    return { channelId: sent.channelId, messageId: sent.id };
}

/**
 * Turn a previously-posted log button message into the "done" state: replace the
 * button with a link to the finished report. Best-effort — returns false on error.
 */
async function finishLogButton(channelId, messageId, { reportUrl, title } = {}) {
    if (!client || !channelId || !messageId) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);
        const components = reportUrl
            ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Auswertung öffnen").setStyle(ButtonStyle.Link).setURL(reportUrl))]
            : [];
        await message.edit({
            content: `✅ **Ausgewertet**${title ? ` – ${title}` : ""}`,
            components,
        });
        return true;
    } catch (e) {
        console.error("finishLogButton failed:", e.message);
        return false;
    }
}

module.exports = {
    setClient, getClient, listGuilds, getGuild, listTextChannels, listEmojis,
    listCategories, listAllChannels, createChannel, duplicateChannel,
    listRoles, getChannelCategoryMap, postAnnouncement,
    listMembersWithRoles, postMissingPing,
    postRecruitment, editRecruitment, deleteMessage, scanRecruitment,
    isRecruitmentMessage, extractTemplate,
    listApplications, parseApplicationEmbed,
    postLogButton, finishLogButton, LOG_EVAL_PREFIX,
};
