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
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

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

module.exports = {
    setClient, getClient, listGuilds, getGuild, listTextChannels,
    postRecruitment, editRecruitment, deleteMessage, scanRecruitment,
    isRecruitmentMessage, extractTemplate,
};
