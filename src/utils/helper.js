const { MessageFlags } = require("discord.js");
const { createRaidhelperClient } = require("./raidhelperClient");
const extendedClassList = require("../config/classlist.js");
const { formatTimestampToDateString } = require("./date.js");
const {
    defaultTimeout,
    embedAccentColor,
} = require("../config/variables");

function getCharacterIcon(interaction, spec) {
    return `${interaction.guild.emojis.cache.find(
        (emoji) => emoji.name === extendedClassList[spec]?.icon
    )}`;
}

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
            }, ],
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

async function botEditReply(
    interaction,
    title,
    message,
    timeout = defaultTimeout,
    ephemeral = true,
    components = []
) {
    try {
        await interaction.editReply({
            embeds: [{
                title: title,
                description: message,
                color: embedAccentColor,
            }, ],
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
            }, ],
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

function formatSignUps(interaction, specs) {
    return specs
        .map((s) => `${getCharacterIcon(interaction, s.specName)}`)
        .join("");
}

function formatSpecs(specs, templateId) {
    let formatted = [];
    let clazz;
    if (specs) {
        specs = specs.split(",").slice(0, 10);
        specs.forEach((spec) => {
            if (extendedClassList[spec]) {
                if (templateId === "40") {
                    clazz = extendedClassList[spec].sodclazz;
                } else {
                    clazz = extendedClassList[spec].clazz;
                }

                formatted.push({
                    className: clazz,
                    specName: extendedClassList[spec].spec,
                });
            }
        });
    }

    return formatted;
}

function getChannelsFromCategories(guild, categoryIds) {
    const channelsFromCategories = [];
    guild.channels.cache.forEach((channel) => {
        if (channel.type === 0) {
            const parent = channel.parent;
            if (parent && categoryIds.includes(parent.id)) {
                channelsFromCategories.push(channel.id);
            }
        }
    });

    return channelsFromCategories;
}

async function showAllEvents(interaction, categoryId) {
    const categoryEvents = await getCategoryEvents(interaction, categoryId);

    const formattedRaids = categoryEvents
        .map(
            (channel) =>
                `**${channel.title}** <t:${Math.round(
                    Number(channel.startTime)
                )}:R> \n<#${channel.channelId}> by <@${
                    channel.leaderId
                }>\n${formatTimestampToDateString(channel.startTime * 1000)} Uhr`
        )
        .join("\n\n");

    return formattedRaids;
}

async function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// The upcoming events of a category from both sources — Raid-Helper's and the
// EventHelper's own (web/eventSources.js) — in Raid-Helper's list shape, soonest
// first. An own event counts when its channel sits in the category or it was
// created for it. A Raid-Helper that does not answer (or is switched off, #291)
// leaves the own events standing instead of failing the whole command.
async function getCategoryEvents(interaction, categoryId) {
    const { ownUpcomingRaw } = require("../web/eventSources");
    const raidhelper = createRaidhelperClient();
    let allEvents = [];
    try {
        allEvents = (await raidhelper.getAllEvents()) || [];
    } catch (error) {
        console.error("getCategoryEvents: Raid-Helper nicht erreichbar:", error && error.message);
    }
    const channelsInCategory = getChannelsFromCategories(interaction.guild, [
        categoryId,
    ]);
    const own = ownUpcomingRaw(interaction.guild ? interaction.guild.id : "")
        .filter((event) => event.categoryId === categoryId || channelsInCategory.includes(event.channelId));
    const categoryEvents = [
        ...allEvents.filter((event) => channelsInCategory.includes(event.channelId)),
        ...own,
    ].sort((eventA, eventB) => eventA.startTime - eventB.startTime);
    return categoryEvents;
}

module.exports = {
    getCategoryEvents,
    delay,
    showAllEvents,
    getChannelsFromCategories,
    formatSignUps,
    formatSpecs,
    botFollowup,
    botReply,
    findServerEmoji,
    getCharacterIcon,
    botEditReply,
};