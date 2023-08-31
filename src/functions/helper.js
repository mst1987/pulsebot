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

var getAuctionMessage = exports.getAuctionMessage = function(legendary) {
    return `${findServerEmoji('shadowmourne')}  **${legendary.name}**\n\nRaid: **${legendary.raid}**\nAuktion endet am **${formatTimestampToDateString(Number(legendary.endtime))}**\n\nStartpreis ist **${legendary.mingold}g** und Mindesterhöhung liegt bei **${legendary.increment}g**\n\nBenutze den /bid Befehl um mitzubieten!`
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

var botReply = exports.botReply = async function(interaction, title, message, timeout = timeoutTime, ephemeral = true) {
    await interaction.reply({
            embeds: [{
                title: title,
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

var getItemsToShow = exports.getItemsToShow = function(items, dateFrom, dateEnd) {
    const filteredItems = items.filter((entry) => {
        const entryDate = parseDMYDateString(entry.date);
        return entryDate >= dateFrom && entryDate <= dateEnd;
    }).sort((a, b) => a.player.localeCompare(b.player));

    const formattedItems = getItemsFormatted(filteredItems);
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

var getItemsFormatted = exports.getItemsFormatted = function(items) {
    return items.map(item => `${getCharacterIcon(item.class)} ${item.player} - [${item.item}](${item.wowhead}) - ${item.gold}g`).join(`\n`);
}

var toTimestamp = exports.toTimestamp = function(dateString) {
    const [datePart, timePart] = dateString.split('-');
    const [day, month, year] = datePart.split('.').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    // Note: In the following line, the year is assumed to be in the 21st century (20xx)
    const dateObject = new Date(2000 + year, month - 1, day, hour, minute);

    const timestamp = dateObject.getTime(); // Convert milliseconds to seconds

    return timestamp
}

var formatTimestampToDateString = exports.formatTimestampToDateString = function(timestamp) {
    const dateObject = new Date(timestamp); // Convert seconds to milliseconds

    const day = String(dateObject.getDate()).padStart(2, '0');
    const month = String(dateObject.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const year = dateObject.getFullYear();
    const hour = String(dateObject.getHours()).padStart(2, '0');
    const minute = String(dateObject.getMinutes()).padStart(2, '0');

    const formattedDateString = `${day}.${month}.${year} um ${hour}:${minute} Uhr`;
    return formattedDateString;
}

var formatNumberWithDots = exports.formatNumberWithDots = function(number) {
    const formattedNumber = number.toLocaleString('en-US'); // Use the 'en-US' locale for comma (,) separator
    return formattedNumber.replace(/,/g, '.');
}