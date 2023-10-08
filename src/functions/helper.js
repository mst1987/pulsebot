const { DateTime } = require('luxon');
const Raidhelper = require('../classes/raidhelper.js');
const { formatTimestampToDateString } = require('./date.js');

const timeoutTime = 60000;

module.exports = {
    isNumber: function(value) {
        return typeof value === 'number' && !isNaN(value);
    },
    getCharacterIcon: function(interaction, spec) {
        return `${interaction.guild.emojis.cache.find(emoji => emoji.name === extendedClassList[spec]?.icon)}`;
    },
    findServerEmoji: function(interaction, emojiName) {
        return `${interaction.guild.emojis.cache.find(emoji => emoji.name === emojiName)}`;
    },
    
    getUserNickname: async function(interaction) {
        const displayName = await interaction.guild.members.fetch(interaction.user.id);
        return displayName;
    },
    botReply: async function(interaction, title, message, timeout = timeoutTime, ephemeral = true, components = []) {
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
    },
    botFollowup: async function(interaction, message, timeout = timeoutTime, ephemeral = true) {
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
    },
    formatSignUps: function(specs) {
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
    },
    getChannelsFromCategories: function(guild, categoryIds) {
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
    },
    formatNumberWithDots: function(number) {
        const formattedNumber = number.toLocaleString('en-US'); // Use the 'en-US' locale for comma (,) separator
        return formattedNumber.replace(/,/g, '.');
    },
    showAllEvents: async function(interaction, categoryId) {
        const categoryEvents = await this.getCategoryEvents(interaction, categoryId);
    
        const formattedRaids = categoryEvents.map(channel => `**${channel.title}**\n<#${channel.channelId}> by <@${channel.leaderId}>\n${formatTimestampToDateString(channel.startTime*1000)} Uhr`).join(`\n\n`);
    
        return formattedRaids;
    },
    delay: async function(ms){
        return new Promise(resolve => {
          setTimeout(resolve, ms);
        });
      },
    getCategoryEvents: async function(interaction, categoryId) {
        const raidhelper = new Raidhelper();
        const allEvents = await raidhelper.getAllEvents();
        const channelsInCategory = this.getChannelsFromCategories(interaction.guild, [categoryId]);
        const categoryEvents = allEvents.filter(event => channelsInCategory.includes(event.channelId));
    
        return categoryEvents;
    }
}







