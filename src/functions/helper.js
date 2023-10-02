const { DateTime } = require('luxon');

const timeoutTime = 60000;

exports.isNumber = function(value) {
    return typeof value === 'number' && !isNaN(value);
}

var getCharacterIcon = exports.getCharacterIcon = function(interaction, spec) {
    return `${interaction.guild.emojis.cache.find(emoji => emoji.name === extendedClassList[spec]?.icon)}`;
}

var findServerEmoji = exports.findServerEmoji = function(interaction, emojiName) {
    return `${interaction.guild.emojis.cache.find(emoji => emoji.name === emojiName)}`;
}

var getAuctionMessage = exports.getAuctionMessage = function(interaction, legendary) {
    return `${findServerEmoji(interaction, 'shadowmourne')}  **${legendary.name}**\n\nRaid: **${legendary.raid}**\nAuktion endet am **${formatTimestampToDateString(Number(legendary.endtime))}**\n\nStartpreis ist **${legendary.mingold}g** und Mindesterhöhung liegt bei **${legendary.increment}g**\n\nBenutze den **/bid** Befehl um mitzubieten!\n\nExample:\`\`\`/bid gold:150000\`\`\``
}

// Function to parse "D-M-YYYY" format
var parseDMYDateString = exports.parseDMYDateString = function(dateString) {
    const parts = dateString.split('-');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months in JavaScript are zero-based
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day);
}

var getUserNickname = exports.getUserNickname = async function(interaction) {
    const displayName = await interaction.guild.members.fetch(interaction.user.id);
    return displayName;
}

var getWednesdayWeeksAgo = exports.getWednesdayWeeksAgo = function(weeks) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Calculate the number of days to subtract to get to the previous Wednesday
    const daysToSubtract = ((today.getDay() + 4) % 7) + 7 * (weeks - 1);

    // Subtract two weeks' worth of days and the calculated daysToSubtract
    const weeksAgo = new Date(today.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);

    return weeksAgo;
}

var botReply = exports.botReply = async function(interaction, title, message, timeout = timeoutTime, ephemeral = true, components = []) {
    await interaction.reply({
            embeds: [{
                title: title,
                description: message
            }],
            ephemeral: ephemeral,
            components
        }).then(msg => {
            if (timeout > 0)
                setTimeout(() => msg.delete(), timeout)
        })
        .catch(error => {
            console.log(error);
        });
}

var botFollowup = exports.botFollowup = async function(interaction, message, timeout = timeoutTime, ephemeral = true) {
    await interaction.followUp({
            embeds: [{
                description: message
            }],
            ephemeral: ephemeral
        }).then(msg => {
            if (timeout > 0)
                setTimeout(() => msg.delete(), timeout)
        })
        .catch(error => {
            console.log(error);
        });
}

var getItemsToShow = exports.getItemsToShow = function(interaction, items, dateFrom, dateEnd) {
    const filteredItems = items.filter((entry) => {
        const entryDate = parseDMYDateString(entry.date);
        return entryDate >= dateFrom && entryDate <= dateEnd;
    }).sort((a, b) => a.player.localeCompare(b.player));

    const formattedItems = getItemsFormatted(interaction, filteredItems);
    const sumOfGold = filteredItems.reduce((totalGold, entry) => totalGold + entry.gold, 0);
    return `${formattedItems}\n\n\nGesamtausgaben: **${sumOfGold}g**`;
}

var formatSignUps = exports.formatSignUps = function(specs) {
    let signUps = [];
    if (specs) {
        specs = specs.split(',')
        specs = specs.slice(0, 10)
        specs.forEach(spec => {
            if (extendedClassList[spec])
                signUps.push({ className: extendedClassList[spec].clazz, specName: extendedClassList[spec].spec })
        })
    }

    return signUps;
}

var getChannelsFromCategories = exports.getChannelsFromCategories = function(guild, categoryIds) {
    const channelsFromCategories = [];

    guild.channels.cache.forEach(channel => {
        if (channel.type === 0) {
            const parent = channel.parent;
            if (parent && categoryIds.includes(parent.id)) {
                channelsFromCategories.push(channel.id);
            }
        }
    });

    return channelsFromCategories;
}

var getItemsFormatted = exports.getItemsFormatted = function(interaction, items) {
    return items.map(item => `${getCharacterIcon(interaction, item.class)} ${item.player} - [${item.item}](${item.wowhead}) - ${item.gold}g`).join(`\n`);
}

var toTimestamp = exports.toTimestamp = function(dateString) {
    const timestampCET = DateTime.fromFormat(dateString, 'dd.MM.yy-HH:mm', { zone: 'Europe/Paris' }).toMillis();

    return timestampCET;
}

var formatTimestampToDateString = exports.formatTimestampToDateString = function(timestamp) {
    // Convert the timestamp to a Luxon DateTime object in CET
    const dateTimeCET = DateTime.fromMillis(timestamp, { zone: 'Europe/Paris' });

    // Format the DateTime object as the desired string format
    const formattedString = dateTimeCET.toFormat('dd.MM.yyyy') + ' um ' + dateTimeCET.toFormat('HH:mm') + ' Uhr';

    return formattedString;
}

var formatNumberWithDots = exports.formatNumberWithDots = function(number) {
    const formattedNumber = number.toLocaleString('en-US'); // Use the 'en-US' locale for comma (,) separator
    return formattedNumber.replace(/,/g, '.');
}