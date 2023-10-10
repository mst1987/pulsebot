const Raidhelper = require('../classes/raidhelper.js');
const { formatTimestampToDateString } = require('./date.js');

const timeoutTime = 60000;

function isNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}

function getCharacterIcon(interaction, spec) {
    return `${interaction.guild.emojis.cache.find(emoji => emoji.name === extendedClassList[spec]?.icon)}`;
}

function findServerEmoji(interaction, emojiName) {
    return `${interaction.guild.emojis.cache.find(emoji => emoji.name === emojiName)}`;
}

async function getUserNickname(interaction) {
    const displayName = await interaction.guild.members.fetch(interaction.user.id);
    return displayName;
}

async function botReply(interaction, title, message, timeout = timeoutTime, ephemeral = true, components = []) {
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

async function botEditReply(interaction, title, message, timeout = timeoutTime, ephemeral = true, components = []) {
    await interaction.editReply({
            embeds: [{
                title: title,
                description: message
            }],
            ephemeral: ephemeral,
            components
        })
        .catch(error => {
            console.log(error);
        });
}

async function botFollowup(interaction, message, timeout = timeoutTime, ephemeral = true) {
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

function formatSignUps(interaction, specs) {
    return specs.map(s => `${getCharacterIcon(interaction, s.specName)}`).join(``);
}

function formatSpecs(specs) {
    let formatted = [];
    if (specs) {
        specs = specs.split(',').slice(0, 10);
        specs.forEach(spec => {
            if (extendedClassList[spec]) {
                formatted.push({ className: extendedClassList[spec].clazz, specName: extendedClassList[spec].spec })
            }
        })
    }

    return formatted;
}

function getChannelsFromCategories(guild, categoryIds) {
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

function checkForPermission(interaction) {
    if (interaction.user.id !== '233598324022837249') {
        botReply(interaction, 'Fehlende Berechtigung', 'Dir fehlt die Berechtigung diese Befehl auszuführen.');
        return false;
    }

    return true;
}

async function getRaidInfosFromChannel(interaction) {
    const raidhelper = new Raidhelper();
    const channelMessages = await interaction.channel.messages.fetch();
    const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');

    for (const [key, value] of botMessages) {
        const event = await raidhelper.getEvent(key);

        if (event.id) {
            const comp = await raidhelper.getSetup(event.id);
            return { raidData: createRaidData(event), setupData: comp ? comp.setup : [] };
        }
    }
}

function createRaidData(event) {
    return {
        raidid: event.id,
        title: event.title,
        description: event.description,
        raidname: event.channelName + ' ' + event.date,
        date: event.date,
        time: event.time,
        isGdkp: true,
    }
}

function formatNumberWithDots(number) {
    const formattedNumber = number.toLocaleString('en-US'); // Use the 'en-US' locale for comma (,) separator
    return formattedNumber.replace(/,/g, '.');
}

async function showAllEvents(interaction, categoryId) {
    const categoryEvents = await getCategoryEvents(interaction, categoryId);

    const formattedRaids = categoryEvents.map(channel => `**${channel.title}** <t:${Math.round(Number(channel.startTime))}:R> \n<#${channel.channelId}> by <@${channel.leaderId}>\n${formatTimestampToDateString(channel.startTime*1000)} Uhr`).join(`\n\n`);

    return formattedRaids;
}

async function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

async function getCategoryEvents(interaction, categoryId) {
    try {
        const raidhelper = new Raidhelper();
        const allEvents = await raidhelper.getAllEvents();
        const channelsInCategory = getChannelsFromCategories(interaction.guild, [categoryId]);
        const categoryEvents = allEvents.filter(event => channelsInCategory.includes(event.channelId));

        return categoryEvents;
    } catch (error) {
        console.log('CATEGORYERROR:', error);
    }
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
    checkForPermission,
    botEditReply
}