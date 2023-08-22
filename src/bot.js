require('dotenv').config({ path: '../.env'});

const classMap = require('./config/variables.js')
const extendedClassList = require('./config/variables.js')
const Raidhelper = require('./classes/raidhelper.js');
const GDKP = require('./classes/gdkp.js');

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: ['MESSAGE', 'REACTION'] });
let guild;
const timeoutTime = 60000;

client.on('ready', () => {
    console.log('Pulse Bot is ready');
})

client.on('interactionCreate', async(interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.bot) return;
    guild = interaction.guild;
    console.log('User: ', interaction.user.username, '- Command:', interaction.commandName);

    const raidhelper = new Raidhelper();

    const category = guild.channels.cache.get("1115368280245420042"); // GDKP 25er Category

    if (interaction.commandName === 'gdkpraids') {
        let signUpChannelIDs = await raidhelper.getEventData(interaction.user.id);
        let missingSignUps = await raidhelper.getMissingSignUps(interaction.user.id);

        if (category) {
            const channelsInCategory = category.children.cache.map(c => c.id);
            // Filter Signups for GDKP category
            const noSignUps = missingSignUps.filter(signUpChannelId => channelsInCategory.includes(signUpChannelId));
            const formattedMissingSignUps = noSignUps.map(channelId => `<#${channelId}>`).join(`\n`);

            // Filter Signups for GDKP category
            const GDKPSignUps = signUpChannelIDs.filter(signUpChannelId => channelsInCategory.includes(signUpChannelId.channelId));

            const SignUpsWithSpecs = GDKPSignUps.map(dataObject => {
                const matchingSignUps = dataObject.signUps.filter(signUp => signUp.userId === interaction.user.id);
                const matchingSpecs = matchingSignUps.map(signUp => `${guild.emojis.cache.find(emoji => emoji.name === classMap[signUp.specName].icon) }`).join('');

                return {
                    specs: matchingSpecs,
                    ...dataObject,
                };
            });

            const formattedGDKPSignUps = SignUpsWithSpecs.map(channelId => `<#${channelId.channelId}>\n ${channelId.specs}\n`).join(`\n`);
            await interaction.reply({
                    embeds: [{
                        title: 'GDKP Sign Ups',
                        description: `Missing/Absence SignUps: \n${formattedMissingSignUps}\n\nSigned Up GDKP Events: \n${formattedGDKPSignUps}`,
                    }],
                    ephemeral: true
                }).then(msg => {
                    setTimeout(() => msg.delete(), timeoutTime)
                })
                .catch(error => {
                    console.log(error);
                });
        } else {
            interaction.reply('Pulse Bot doesnt have a correct Setup yet.');
        }
    }
    if (interaction.commandName === 'mysetups') {
        let setups = [];
        // get all Events the user signed up for
        let signUpChannelEvents = await raidhelper.getEventData(interaction.user.id);

        if (category) {
            const channelsInCategory = category.children.cache.map(c => c.id);
            const GDKPSignUps = signUpChannelEvents.filter(signUpChannelEvent => channelsInCategory.includes(signUpChannelEvent.channelId));

            await Promise.all(GDKPSignUps.map(async(signup) => {
                const setup = await raidhelper.getSetup(signup.id);
                if (setup) {
                    setups.push({ channelid: signup.channelId, startTime: signup.startTime, ...setup });
                }
            }));
            if (setups.length > 0) {
                const guild = interaction.guild;
                // Filter Setups, sort it and only get User data
                const setupData = setups.filter((setup, index) => {
                    return setup.setup.some(user => user.userid === interaction.user.id);
                }).sort((eventA, eventB) => eventA.startTime - eventB.startTime).map(slot => ({...slot, setup: slot.setup.filter(user => user.userid === interaction.user.id) }));

                // Format Signup and get Discord Emojis for the classes
                const formattedGDKPSignUps = setupData.map(channelId => `<#${channelId.channelid}> ${guild.emojis.cache.find(emoji => emoji.name === classMap[channelId.setup[0].spec].icon)} ${classMap[channelId.setup[0].spec].name}`).join(`\n`);

                await interaction.reply({
                        embeds: [{
                            title: 'Setups',
                            description: `\n${formattedGDKPSignUps}`,
                        }],
                        ephemeral: true
                    }).then(msg => {
                        setTimeout(() => msg.delete(), timeoutTime)
                    })
                    .catch(error => {
                        console.log(error);
                    })
            } else {
                await interaction.reply({
                    embeds: [{
                        title: 'Setups',
                        description: `Momentan in keinem Setup gesetzt. Neue Setups kommen bald!`,
                    }],
                    ephemeral: true
                }).then(msg => {
                    setTimeout(() => msg.delete(), timeoutTime)
                })
                .catch(error => {
                    console.log(error);
                })
            }

        } else {
            interaction.channel.send('Pulse Bot doesnt have a correct Setup yet.');
        }
    }

    if (interaction.commandName === 'lastspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        const title = 'Letzte ID gekauft: '
        if (!totalItems) {
            botReply(interaction, title, `Keine Items gekauft in der letzten ID. Eventuell ist die Datenbank nicht aktuell!`);
        } else {
            const formattedItems = getItemsToShow(totalItems, getWednesdayWeeksAgo(2), getWednesdayWeeksAgo(1));
            botReply(interaction, title, formattedItems)
        }
    }

    if (interaction.commandName === 'currentspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        const title = 'Diese ID gekauft: '
        if (!currentSpent) {
            botReply('Diese ID gekauft:', `Keine Items gekauft in der momentanen ID. Eventuell ist die Datenbank nicht aktuell!`);
        } else {
            const formattedItems = getItemsToShow(totalItems, getWednesdayWeeksAgo(1), new Date());
            botReply(interaction, title, formattedItems)
        }
    }

    if (interaction.commandName === 'totalspent') {
        const gdkp = new GDKP();
        let currentSpent = await gdkp.getTotalItems(interaction.user.id);
        if (!currentSpent) {
            botReply('Gesamte Itemhistorie:', `Keine Items gekauft. Eventuell ist die Datenbank nicht aktuell!`);
        } else {
            currentSpent = currentSpent.sort((a, b) => a.player.localeCompare(b.player))

            let i = 0,
                j = -1;
            let formattedItems = [];
            currentSpent.forEach(current => {
                if (i % 15 === 0 || i === 0) {
                    formattedItems[++j] = [];
                }
                formattedItems[j].push(`${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[current.class]?.icon)} ${current.player} - [${current.item}](${current.wowhead}) - ${current.gold}g`)
                i++;
            })
            const sumOfGold = currentSpent.reduce((totalGold, entry) => totalGold + entry.gold, 0);

            await interaction.reply({
                embeds: [{
                    title: `Gesamte Itemhistorie:`,
                    description: `Gesamtausgaben: **${sumOfGold}g**\n\n${formattedItems[0].join('\n')}`,
                }],
                ephemeral: true
            })

            if (formattedItems.length > 1)
                formattedItems.forEach(async(items, key) => {
                    if (key > 0)
                        await interaction.followUp({
                            embeds: [{
                                description: `${items.join('\n')}`,
                            }],
                            ephemeral: true
                        });
                })
        }
    }

    if (interaction.commandName === 'signup') {
        let signUps = [];
        let raidId = '';
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');

        for (const [key, value] of botMessages) {
            await interaction.channel.messages.fetch();
            if (raidhelper.checkIfEvent(key))
                raidId = key;
            else interaction.reply({
                embeds: {
                    title: 'Anmeldung nicht möglich',
                    description: 'Keinen passenden Raid gefunden.'
                },
                ephemeral: true
            })
        }

        try {
            let specs = [];
            const signedUpSpecs = interaction.options.getString('specs');

            if (signedUpSpecs) {
                specs = signedUpSpecs.split(',')
                specs = specs.slice(0, 10)
                specs.forEach(spec => {
                    if (extendedClassList[spec])
                        signUps.push({ className: extendedClassList[spec].clazz, specName: extendedClassList[spec].spec })
                })
            }

            response = raidhelper.signUpToRaid(raidId, signUps, interaction.user.id);

            const formattedGDKPSignUps = signUps.map(s => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[s.specName].icon)}`).join(``);
            await interaction.reply({
                    embeds: [{
                        title: 'Sign Up',
                        description: `You signed up as ${formattedGDKPSignUps}\n Keep in mind, the raidhelper can take a bit until changes are shown.`,
                    }],
                    ephemeral: true,
                }).then(msg => {
                    setTimeout(() => msg.delete(), timeoutTime)
                })
                .catch(error => {
                    console.log(error);
                });
        } catch (error) {
            console.log(error)
        }
    }
    if (interaction.commandName === 'signupChoice') {
        let signUps = []

        try {
            raidId = interaction.options.getString('raid')

            const extraclasses = interaction.options.getString('specs');
            specs = [];
            if (extraclasses) {
                specs = extraclasses.split(',')
                specs = specs.slice(0, 10)
                specs.forEach(spec => {
                    if (extendedClassList[spec])
                        signUps.push({ className: extendedClassList[spec].clazz, specName: extendedClassList[spec].spec })
                })
            }

            for (let signUp of signUps) {
                console.log('Waiting...', signUp.specName)
                const response = await raidhelper.signUpToRaid(raidId, signUp, interaction.user.id).then((responseData) => {
                    console.log(signUp.specName, ' done.')
                })
            }

            const formattedGDKPSignUps = signUps.map(s => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[s.specName].icon)}`).join(``);

            await interaction.reply({
                    embeds: [{
                        title: 'Sign Up',
                        description: 'You signed up as \n' + formattedGDKPSignUps,
                    }],
                    ephemeral: true
                }).then(msg => {
                    setTimeout(() => msg.delete(), timeoutTime)
                })
                .catch(error => {
                    console.log(error);
                })
        } catch (error) {
            console.log(error)
        }

        //interaction.reply('Classes #extra:' + extraClasses)
    }
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
    const today = new Date();
    
    // Calculate the number of days to subtract to get to the previous Wednesday
    const daysToSubtract = (today.getDay() + 5) % 7;
  
    // Subtract two weeks' worth of days and the calculated daysToSubtract
    const weeksAgo = new Date(today.getTime() - (7*weeks) * 24 * 60 * 60 * 1000 - daysToSubtract * 24 * 60 * 60 * 1000);
  
    return weeksAgo;
  }

async function botReply(interaction, title, message, timeout = timeoutTime) {
    await interaction.reply({
        embeds: [{
            title: title,//'Diese ID gekauft:',
            description: message //`Keine Items gekauft in der momentanen ID. Eventuell ist die Datenbank nicht aktuell!`,
        }],
        ephemeral: true
    }).then(msg => {
        if(timeout > 0)
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

    const formattedItems = getEmojis(filteredItems);
    const sumOfGold = filteredItems.reduce((totalGold, entry) => totalGold + entry.gold, 0);
    return `${formattedItems}\n\n\nGesamtausgaben: **${sumOfGold}g**`;
}

function getEmojis(items) {
    return items.map(item => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[item.class]?.icon)} ${item.player} - [${item.item}](${item.wowhead}) - ${item.gold}g`).join(`\n`);
}

client.login(process.env.DISCORDJS_BOT_TOKEN);
