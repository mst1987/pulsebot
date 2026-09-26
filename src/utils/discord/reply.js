// Replies of the slash commands: one embed in the accent color, ephemeral by
// default, deleted again after `timeout` ms (0 keeps it), plus the lookups of a
// server emoji. The reply helpers never throw — a failed reply is logged.
const { MessageFlags } = require("discord.js");
const { entryFor } = require("../../config/classlist.js");
const {
    defaultTimeout,
    embedAccentColor,
} = require("../../config/variables");

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

async function botReply(
    interaction,
    title,
    message,
    timeout = defaultTimeout,
    ephemeral = true,
    components = []
) {
    try {
        const msg = await interaction.reply({
            embeds: [{
                title: title,
                description: message,
                color: embedAccentColor,
            }],
            ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
            components,
        });

        if (timeout > 0) {
            setTimeout(() => msg.delete().catch(console.error), timeout);
        }
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
        const msg = await interaction.followUp({
            embeds: [{
                description: message,
            }],
            ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
            components,
        });

        if (timeout > 0) {
            setTimeout(() => msg.delete().catch(console.error), timeout);
        }
    } catch (error) {
        console.error("Error in botFollowup:", error.message);
    }
}

module.exports = {
    botReply,
    botEditReply,
    botFollowup,
    findServerEmoji,
    getCharacterIcon,
};
