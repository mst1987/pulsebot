require('dotenv').config({ path: '../.env' });

const extendedClassList = require('./config/variables.js');
const Raidhelper = require('./classes/raidhelper.js');
const GDKP = require('./classes/gdkp.js');
const Legendary = require('./classes/legendary.js');
const messages = require('./config/messages.js');

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: ['MESSAGE', 'REACTION'] });
let guild;
const timeoutTime = 60000;

client.on('ready', () => {
    console.log(messages.common.pulseBotReady);
})

client.on('interactionCreate', async(interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.bot) return;
    guild = interaction.guild;
    const legendaryID = '1144865420386517053';

    // Logging User Command
    console.log('User: ', interaction.user.username, '- Command:', interaction.commandName);

    const raidhelper = new Raidhelper();
    const commandName = interaction.commandName;
    const categoryIds = ['1115368280245420042', '1143858079289577502'];
    const channelsInCategory = getChannelsFromCategories(categoryIds);

    // GDKP Raid commands
    if (commandName === 'gdkpraids') {
        let signUpChannelIDs = await raidhelper.getUserSignUps(interaction.user.id);
        let missingSignUps = await raidhelper.getMissingSignUps(interaction.user.id);

        if (channelsInCategory) {
            // Filter Signups for GDKP category
            const noSignUps = missingSignUps.filter(signUpChannelId => channelsInCategory.includes(signUpChannelId));
            const formattedMissingSignUps = noSignUps.map(channelId => `<#${channelId}>`).join(`\n`);

            // Filter Signups for GDKP category
            const GDKPSignUps = signUpChannelIDs.filter(signUpChannelId => channelsInCategory.includes(signUpChannelId.channelId));
            const SignUpsWithSpecs = GDKPSignUps.map(dataObject => {
                const matchingSignUps = dataObject.signUps.filter(signUp => signUp.userId === interaction.user.id);
                const matchingSpecs = matchingSignUps.map(signUp => `${getCharacterIcon(signUp.specName) }`).join('');

                return {
                    specs: matchingSpecs,
                    ...dataObject,
                };
            });

            const formattedGDKPSignUps = SignUpsWithSpecs.map(channelId => `<#${channelId.channelId}>\n ${channelId.specs}\n`).join(`\n`);
            await botReply(interaction, messages.gdkpraids.successTitle, messages.gdkpraids.missingSignups.replace('___replace___', formattedMissingSignUps) + messages.gdkpraids.signups.replace('___replace___', formattedGDKPSignUps));
        } else {
            await botReply(interaction, messages.gdkpraids.errorTitle, messages.gdkpraids.errorMessage)
        }
    }
    if (commandName === 'mysetups') {
        let setups = [];
        // get all Events the user signed up for
        let signUpChannelEvents = await raidhelper.getUserSignUps(interaction.user.id);

        if (categoryIds) {
            const GDKPSignUps = signUpChannelEvents.filter(signUpChannelEvent => channelsInCategory.includes(signUpChannelEvent.channelId));

            await Promise.all(GDKPSignUps.map(async(signup) => {
                const setup = await raidhelper.getSetup(signup.id);
                if (setup) {
                    setups.push({ channelid: signup.channelId, startTime: signup.startTime, ...setup });
                }
            }));

            if (setups.length < 1) await botReply(interaction, messages.mysetups.errorTitle, messages.gdkpraids.errorMessage)
            else {
                // Filter Setups, sort it and only get User data
                const setupData = setups.filter((setup, index) => {
                    return setup.setup.some(user => user.userid === interaction.user.id);
                }).sort((eventA, eventB) => eventA.startTime - eventB.startTime).map(slot => ({...slot, setup: slot.setup.filter(user => user.userid === interaction.user.id) }));

                // Format Signup and get Discord Emojis for the classes
                const formattedGDKPSignUps = setupData.map(channelId => `<#${channelId.channelid}> ${getCharacterIcon(channelId.setup[0].spec)} ${extendedClassList[channelId.setup[0].spec].name}`).join(`\n`);

                await botReply(interaction, messages.mysetups.errorTitle, `\n${formattedGDKPSignUps}`)
            }
        } else {
            interaction.channel.send(messages.common.pulseBotSetupError);
        }
    }

    if (commandName === 'lastspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(interaction, messages.lastspent.errorTitle, messages.lastspent.errorMessage);
        } else {
            const formattedItems = getItemsToShow(totalItems, getWednesdayWeeksAgo(2), getWednesdayWeeksAgo(1));
            await botReply(interaction, messages.lastspent.successTitle, formattedItems)
        }
    }

    if (commandName === 'currentspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(interaction, messages.currentspent.errorTitle, messages.currentspent.errorMessage);
        } else {
            const formattedItems = getItemsToShow(totalItems, getWednesdayWeeksAgo(1), new Date());
            await botReply(interaction, messages.currentspent.successTitle, formattedItems)
        }
    }

    if (commandName === 'totalspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(interaction, messages.totalspent.errorTitle, messages.totalspent.errorMessage);
        } else {
            totalItems = totalItems.sort((a, b) => a.player.localeCompare(b.player))

            let i = 0,
                j = -1;
            let formattedItems = [];
            totalItems.forEach(current => {
                if (i % 15 === 0 || i === 0) {
                    formattedItems[++j] = [];
                }
                formattedItems[j].push(`${getCharacterIcon(current.class)} ${current.player} - [${current.item}](${current.wowhead}) - ${current.gold}g`)
                i++;
            })
            const sumOfGold = totalItems.reduce((totalGold, entry) => totalGold + entry.gold, 0);
            await botReply(interaction, messages.totalspent.successTitle, `Gesamtausgaben: **${sumOfGold}g**\n\n${formattedItems[0].join('\n')}`);

            if (formattedItems.length > 1)
                formattedItems.forEach(async(items, key) => {
                    if (key > 0)
                        await interaction.followUp({
                            embeds: [{
                                description: `${items.join('\n')}`,
                            }],
                            ephemeral: true
                        }).then(msg => {
                            if (timeout > 0)
                                setTimeout(() => msg.delete(), timeout)
                        });
                })
        }
    }

    if (commandName === 'signup') {
        let raidId;
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');

        for (const [key, value] of botMessages) {
            await interaction.channel.messages.fetch();
            if (raidhelper.checkIfEvent(key)) raidId = key;
            else await botReply(interaction, messages.signup.errorTitle, messages.signup.errorMessage);
        }

        try {
            const signedUpSpecs = interaction.options.getString('specs');
            const signUps = formatSignUps(signedUpSpecs);
            const formattedGDKPSignUps = signUps.map(s => `${getCharacterIcon(s.specName)}`).join(``);
            raidhelper.signUpToRaid(raidId, signUps, interaction.user.id);

            await botReply(interaction, messages.signup.successTitle, messages.signup.successMessage.replace('___replace___', formattedGDKPSignUps));
        } catch (error) {
            console.log(error)
        }
    }
    // --------------------------------------------------------

    // Legendary Bidding Commands

    if (commandName === 'bid') {
        const role = interaction.member.roles.cache.find(role => role.id === legendaryID);
        if (!role) botReply(interaction, 'Fehlende Berechtigung', 'Dir fehlt die Legendary Rolle diesen Befehl auszuführen.');
        const legendary = new Legendary();
        if (!legendary.getAuction(interaction.channel.id)) botReply(interaction, 'Auktion Info', 'Keine Auktion aktiv für diesen Channel');

        botReply(interaction, 'Bid Info', response.message, false);

        const bidData = {
            username: interaction.user.name,
            userid: interaction.options.getString('raid'),
            gold: interaction.channel.id,
            timestamp: new Date().getTime(),
            legendary: interaction.channel.id,
        }

        response = await legendary.bid(bidData);

        if (response) {
            botReply(interaction, 'Bid Info', response.message);
        } else {
            botReply(interaction, 'Fehler', 'Ein Fehler ist vorgefallen...');
        }
    }

    if (commandName === 'createauction') {
        if (interaction.user.id !== '233598324022837249') botReply(interaction, 'Fehlende Berechtigung', 'Dir fehlt die Berechtigung diese Befehl auszuführen.');

        const legendary = new Legendary();
        const auctionData = {
            name: interaction.options.getString('name'),
            raid: interaction.options.getString('raid'),
            channel: interaction.channel.id,
            endtime: interaction.options.getString('endtime'),
            mingold: interaction.options.getString('mingold'),
            increment: interaction.options.getString('increment'),
        }

        response = await legendary.createAuction(auctionData);

        if (response) {
            botReply(interaction, 'Auktion anlegen', response.message);
        } else {
            botReply(interaction, 'Fehler', 'Ein Fehler ist vorgefallen...');
        }
    }

    if (commandName === 'endauction') {
        if (interaction.user.id !== '233598324022837249') botReply(interaction, 'Fehlende Berechtigung', 'Dir fehlt die Berechtigung diese Befehl auszuführen.');

        botReply(interaction, 'Command not usable yet');
    }

    if (commandName === 'auctionstatus') {
        botReply(interaction, 'Command not usable yet');
    }

    // --------------------------------------------------------

})

// Function to parse "D-M-YYYY" format
function parseDMYDateString(dateString) {
    const parts = dateString.split('-');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months in JavaScript are zero-based
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day);
}

function getWednesdayWeeksAgo(weeks) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Calculate the number of days to subtract to get to the previous Wednesday
    const daysToSubtract = ((today.getDay() + 4) % 7) + 7 * (weeks - 1);

    // Subtract two weeks' worth of days and the calculated daysToSubtract
    const weeksAgo = new Date(today.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);

    return weeksAgo;
}

async function botReply(interaction, title, message, timeout = timeoutTime) {
    await interaction.reply({
            embeds: [{
                title: title,
                description: message
            }],
            ephemeral: true
        }).then(msg => {
            if (timeout > 0)
                setTimeout(() => msg.delete(), timeout)
        })
        .catch(error => {
            console.log(error);
        });
}

function getItemsToShow(items, dateFrom, dateEnd) {
    const filteredItems = items.filter((entry) => {
        const entryDate = parseDMYDateString(entry.date);
        return entryDate >= dateFrom && entryDate <= dateEnd;
    }).sort((a, b) => a.player.localeCompare(b.player));

    const formattedItems = getItemsFormatted(filteredItems);
    const sumOfGold = filteredItems.reduce((totalGold, entry) => totalGold + entry.gold, 0);
    return `${formattedItems}\n\n\nGesamtausgaben: **${sumOfGold}g**`;
}

function formatSignUps(specs) {
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

function getChannelsFromCategories(categoryIds) {
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

function getCharacterIcon(spec) {
    return `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[spec]?.icon)}`;
}

function getItemsFormatted(items) {
    return items.map(item => `${getCharacterIcon(item.class)} ${item.player} - [${item.item}](${item.wowhead}) - ${item.gold}g`).join(`\n`);
}

client.login(process.env.DISCORDJS_BOT_TOKEN);