// Replies of the slash commands: one embed in the accent color, ephemeral by
// default, deleted again after `timeout` ms (0 keeps it), plus the lookups of a
// server emoji. The reply helpers never throw — a failed reply is logged.
//
// Every helper takes either its positional arguments (title, message, …) or one
// options object with an `embed` (#508):
//
//   botReply(interaction, { embed: { title, description, fields, color, footer, timestamp }, components, ephemeral, timeout })
//
// `buildEmbed` shapes that embed through discord.js' EmbedBuilder: the accent
// colour unless one is given, every text clipped to Discord's limits (one text
// too long would make Discord refuse the whole reply).
const { MessageFlags, EmbedBuilder } = require("discord.js");
const { entryFor } = require("../../config/classlist.js");
const {
    defaultTimeout,
    embedAccentColor,
} = require("../../config/variables");

/** Discord's embed limits (characters; at most 25 fields; 6000 characters in all). */
const EMBED_LIMITS = Object.freeze({
    title: 256,
    description: 4096,
    fieldName: 256,
    fieldValue: 1024,
    fields: 25,
    footer: 2048,
    author: 256,
    total: 6000,
});

const BLANK = "​";

/** A text cut to `max` characters, ending in "…" when it had to be cut. */
function clip(text, max) {
    const s = String(text === null || text === undefined ? "" : text);
    if (s.length <= max) return s;
    if (max <= 0) return "";
    return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One embed as the plain object Discord takes. Empty parts are left out;
 * `color` defaults to the accent colour, `timestamp` takes a Date, ms, an ISO
 * string or `true` (now), `footer` a text or `{ text, iconURL }`, `author` the small
 * line above the title (a text).
 */
function buildEmbed({ title, description, fields, color, footer, timestamp, url, author } = {}) {
    const embed = new EmbedBuilder().setColor(Number.isInteger(color) ? color : embedAccentColor);
    let budget = EMBED_LIMITS.total;
    const take = (text, max) => {
        const out = clip(text, Math.min(max, budget));
        budget -= out.length;
        return out;
    };
    const a = author ? take(author, EMBED_LIMITS.author) : "";
    if (a) embed.setAuthor({ name: a });
    const t = title ? take(title, EMBED_LIMITS.title) : "";
    if (t) embed.setTitle(t);
    if (t && url) embed.setURL(url);
    const d = description ? take(description, EMBED_LIMITS.description) : "";
    if (d) embed.setDescription(d);
    const list = (Array.isArray(fields) ? fields : [])
        .filter((f) => f && (f.name || f.value))
        .slice(0, EMBED_LIMITS.fields);
    for (const f of list) {
        if (budget < 2) break;
        const name = take(f.name || BLANK, EMBED_LIMITS.fieldName) || BLANK;
        const value = take(f.value || BLANK, EMBED_LIMITS.fieldValue) || BLANK;
        embed.addFields({ name, value, inline: !!f.inline });
    }
    const foot = footer && typeof footer === "object" ? footer : { text: footer };
    if (foot.text && budget > 0) {
        embed.setFooter({ text: take(foot.text, EMBED_LIMITS.footer), ...(foot.iconURL ? { iconURL: foot.iconURL } : {}) });
    }
    if (timestamp !== undefined && timestamp !== null && timestamp !== false) {
        embed.setTimestamp(timestamp === true ? new Date() : new Date(timestamp));
    }
    return embed.toJSON();
}

/** The payload of an embed answer: `{ embeds, components, flags? }`; `embed` is a buildEmbed input. */
function embedPayload(embed, { ephemeral = true, components = [] } = {}) {
    return {
        embeds: [buildEmbed(embed)],
        components,
        ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    };
}

/** Whether a helper got the options form (`{ embed }`) instead of positional arguments. */
const isOptions = (arg) => !!arg && typeof arg === "object" && !Array.isArray(arg) && !!arg.embed && typeof arg.embed === "object";

/** The server emoji of a spec's class icon, as text ("undefined" when the server has none). */
function getCharacterIcon(interaction, spec) {
    return `${interaction.guild.emojis.cache.find(
        (emoji) => emoji.name === entryFor(spec)?.icon
    )}`;
}

/** A server emoji by name, as text ("undefined" when the server has none). */
function findServerEmoji(interaction, emojiName) {
    return `${interaction.guild.emojis.cache.find(
        (emoji) => emoji.name === emojiName
    )}`;
}

function autoDelete(msg, timeout) {
    if (msg && timeout > 0) {
        setTimeout(() => msg.delete().catch(console.error), timeout);
    }
}

async function botReply(
    interaction,
    title,
    message,
    timeout = defaultTimeout,
    ephemeral = true,
    components = []
) {
    try {
        if (isOptions(title)) {
            const opts = title;
            const msg = await interaction.reply(embedPayload(opts.embed, {
                ephemeral: opts.ephemeral !== false,
                components: opts.components || [],
            }));
            autoDelete(msg, opts.timeout === undefined ? defaultTimeout : opts.timeout);
            return;
        }
        const msg = await interaction.reply({
            embeds: [{
                title: title,
                description: message,
                color: embedAccentColor,
            }],
            ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
            components,
        });

        autoDelete(msg, timeout);
    } catch (error) {
        console.error("Error in botReply:", error.message);
    }
}

// Same argument order as botReply; timeout and ephemeral have no effect on an
// edit (a deferred reply keeps the visibility it was deferred with), they only
// keep the positions so `components` stays the sixth argument.
async function botEditReply(
    interaction,
    title,
    message,
    _timeout = defaultTimeout,
    _ephemeral = true,
    components = []
) {
    try {
        if (isOptions(title)) {
            const { embeds } = embedPayload(title.embed);
            await interaction.editReply({ content: "", embeds, components: title.components || [] });
            return;
        }
        await interaction.editReply({
            embeds: [{
                title: title,
                description: message,
                color: embedAccentColor,
            }],
            components,
        });
    } catch (error) {
        console.error("Error in botEditReply:", error.message);
    }
}

async function botFollowup(
    interaction,
    message,
    timeout = defaultTimeout,
    ephemeral = true,
    components = []
) {
    try {
        if (isOptions(message)) {
            const opts = message;
            const msg = await interaction.followUp(embedPayload(opts.embed, {
                ephemeral: opts.ephemeral !== false,
                components: opts.components || [],
            }));
            autoDelete(msg, opts.timeout === undefined ? defaultTimeout : opts.timeout);
            return;
        }
        const msg = await interaction.followUp({
            embeds: [{
                description: message,
            }],
            ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
            components,
        });

        autoDelete(msg, timeout);
    } catch (error) {
        console.error("Error in botFollowup:", error.message);
    }
}

module.exports = {
    EMBED_LIMITS,
    clip,
    buildEmbed,
    embedPayload,
    botReply,
    botEditReply,
    botFollowup,
    findServerEmoji,
    getCharacterIcon,
};
