// The one line per raid of /mysetups and /showallsetups: where the raider
// stands in the setup of an event.
const { getCharacterIcon, findServerEmoji } = require("../discord/reply");
const { formatTimestampToDateString } = require("../time");
const { entryFor } = require("../../config/classlist.js");

function setupResponse(interaction, event) {
    let notInSetup = "Setup not done yet";
    let emoji = "copium";
    let inSetup = false;
    if (event.setup) {
        notInSetup = "Not in Setup";
        emoji = "sadcat";
        inSetup = event.setup.find((signUp) => signUp.id === interaction.user.id);
    }

    const spec = inSetup ? inSetup.specName : undefined;
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

module.exports = {
    setupResponse,
};
