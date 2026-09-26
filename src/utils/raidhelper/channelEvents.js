// The events of a Discord category, from both sources — Raid-Helper's and the
// EventHelper's own (web/eventSources.js) — for the legacy setup commands.
const { createRaidhelperClient } = require("./client");
const { ownUpcomingRaw } = require("../../web/eventSources");
const { formatTimestampToDateString } = require("../time");

/** The ids of the text channels below the given categories. */
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

// The upcoming events of a category in Raid-Helper's list shape, soonest
// first. An own event counts when its channel sits in the category or it was
// created for it. A Raid-Helper that does not answer (or is switched off, #291)
// leaves the own events standing instead of failing the whole command.
async function getCategoryEvents(interaction, categoryId) {
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
    return [
        ...allEvents.filter((event) => channelsInCategory.includes(event.channelId)),
        ...own,
    ].sort((eventA, eventB) => eventA.startTime - eventB.startTime);
}

/** The events of a category as the text of /update-events. */
async function showAllEvents(interaction, categoryId) {
    const categoryEvents = await getCategoryEvents(interaction, categoryId);

    return categoryEvents
        .map(
            (channel) =>
                `**${channel.title}** <t:${Math.round(
                    Number(channel.startTime)
                )}:R> \n<#${channel.channelId}> by <@${
                    channel.leaderId
                }>\n${formatTimestampToDateString(channel.startTime * 1000)} Uhr`
        )
        .join("\n\n");
}

module.exports = {
    getCategoryEvents,
    getChannelsFromCategories,
    showAllEvents,
};
