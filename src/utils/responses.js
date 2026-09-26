const { getCharacterIcon, findServerEmoji } = require("./helper.js");
const { formatTimestampToDateString } = require("./date.js");
const { entryFor } = require("../config/classlist.js");

function setupResponse(interaction, event) {
    let notInSetup = "Setup not done yet";
    let emoji = "copium";
    let inSetup = false;
    if (event.setup) {
        notInSetup = "Not in Setup";
        emoji = "sadcat";
        inSetup = event.setup.find((signUp) => signUp.id === interaction.user.id);
    }

    let spec;
    if (inSetup) spec = inSetup.specName;
    return `<#${event.channelid}> <t:${Math.round(
        Number(event.startTime)
    )}:R> \n ${
        spec
            ? getCharacterIcon(interaction, spec)
            : findServerEmoji(interaction, emoji)
    } **${
        spec ? entryFor(spec).name : notInSetup
    }**\n${formatTimestampToDateString(event.startTime * 1000)} Uhr\n`;
}

function mySetupResponse(interaction, events) {
    // Filter Setups, sort it and only get User data
    const setupData = events
        .filter((event) => {
            return event.setup.some((user) => user.userid === interaction.user.id);
        })
        .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
        .map((slot) => ({
            ...slot,
            setup: slot.setup.filter((user) => user.userid === interaction.user.id),
        }));

    // Format Signup and get Discord Emojis for the classes
    return setupData
        .map(
            (channel) =>
                `<#${channel.channelid}> ${getCharacterIcon(
                    interaction,
                    channel.setup[0].spec
                )} ${
                    entryFor(channel.setup[0].spec).name
                }\n${formatTimestampToDateString(channel.startTime * 1000)} Uhr\n`
        )
        .join("\n");
}

module.exports = {
    mySetupResponse,
    setupResponse,
};
