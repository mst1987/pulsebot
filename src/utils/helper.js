const { createRaidhelperClient } = require("./raidhelperClient");
const extendedClassList = require("../config/classlist.js");
const { formatTimestampToDateString } = require("./date.js");
const {
    raidhelperBotId,
    defaultTimeout,
    embedAccentColor,
} = require("../config/variables");

function isNumber(value) {
    return typeof value === "number" && !isNaN(value);
}

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

async function getUserNickname(interaction) {
    const displayName = await interaction.guild.members.fetch(
        interaction.user.id
    );
    return displayName;
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
            ephemeral: ephemeral,
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
            ephemeral: ephemeral,
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
            ephemeral: ephemeral,
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

async function getRaidInfosFromChannel(interaction) {
    const raidhelper = createRaidhelperClient();
    const channelMessages = await interaction.channel.messages.fetch();
    const botMessages = channelMessages.filter(
        (msg) => msg.author.id === raidhelperBotId
    );

    for (const [key, value] of botMessages) {
        const event = await raidhelper.getEvent(key);

        if (event.id) {
            const comp = await raidhelper.getSetup(event.id);
            return {
                raidData: createRaidData(event),
                setupData: comp ? comp.setup : [],
            };
        }
    }
}

function createRaidData(event) {
    return {
        raidid: event.id,
        title: event.title,
        description: event.description,
        raidname: event.channelName + " " + event.date,
        date: event.date,
        time: event.time,
        isGdkp: true,
    };
}

function formatNumberWithDots(number) {
    const formattedNumber = number.toLocaleString("en-US");
    return formattedNumber.replace(/,/g, ".");
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
// created for it.
async function getCategoryEvents(interaction, categoryId) {
    const { ownUpcomingRaw } = require("../web/eventSources");
    const raidhelper = createRaidhelperClient();
    const allEvents = await raidhelper.getAllEvents();
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
    isNumber,
    getCategoryEvents,
    delay,
    showAllEvents,
    formatNumberWithDots,
    getChannelsFromCategories,
    formatSignUps,
    formatSpecs,
    botFollowup,
    botReply,
    getUserNickname,
    findServerEmoji,
    getCharacterIcon,
    getRaidInfosFromChannel,
    botEditReply,
};