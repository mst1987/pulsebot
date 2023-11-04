async function updateHighestBids(interaction, targetMessage, legendary, client) {
    const getHighestBids = await legendary.getHighestBids();
    const channel = await client.channels.fetch('1145659881362313248');
    if (channel) {
        const formattedResponse = getHighestBids.highestBids.sort((bidA, bidB) => Number(bidA.endtime) - Number(bidB.endtime)).map(highestBid => {
            if (highestBid._id !== '1152194523951267931') {
                if (highestBid.endtime > DateTime.now().setZone('Europe/Paris').toMillis()) {
                    return `\n<#${highestBid._id}> **${formatNumberWithDots(highestBid.highestGold)}g** from <@${highestBid.userid}>\nEnds <t:${Math.round(Number(highestBid.endtime/1000))}:R> at **${formatTimestampToDateString(Math.round(Number(highestBid.endtime)))}**`;
                } else {
                    return `\n<#${highestBid._id}> \nGewonnen von <@${highestBid.userid}> für **${formatNumberWithDots(highestBid.highestGold)}g**\n${findServerEmoji(interaction, 'peepoParty')} Gratulation! ${findServerEmoji(interaction, 'peepoParty')}`;
                }
            }
        }).join('\n');

        const embed = { title: 'Auktionsübersicht', description: `${formattedResponse}` };
        await targetMessage.edit({ embeds: [embed] });
    }
}

async function getTargetMessage(client, channelId, messageId) {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
        return await channel.messages.fetch(messageId);
    }

    return false;
}

module.exports = {
    updateHighestBids,
    getTargetMessage
}