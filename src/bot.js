require('dotenv').config({ path: '../.env'});

const extendedClassList = require('./config/variables.js');
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
    

    // Logging User Command
    console.log('User: ', interaction.user.username, '- Command:', interaction.commandName);

    const raidhelper = new Raidhelper();
    const commandName = interaction.commandName;
    const category = guild.channels.cache.get("1115368280245420042"); // GDKP 25er Category

    if (commandName === 'gdkpraids') {
        let signUpChannelIDs = await raidhelper.getUserSignUps(interaction.user.id);
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
                const matchingSpecs = matchingSignUps.map(signUp => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[signUp.specName].icon) }`).join('');

                return {
                    specs: matchingSpecs,
                    ...dataObject,
                };
            });

            const formattedGDKPSignUps = SignUpsWithSpecs.map(channelId => `<#${channelId.channelId}>\n ${channelId.specs}\n`).join(`\n`);
            botReply(interaction, 'GDKP Raid SIgn Ups', `Missing/Absence SignUps: \n${formattedMissingSignUps}\n\nSigned Up GDKP Events: \n${formattedGDKPSignUps}`)
        } else {
            interaction.reply('Pulse Bot doesnt have a correct Setup yet.');
        }
    }
    if (commandName === 'mysetups') {
        let setups = [];
        // get all Events the user signed up for
        let signUpChannelEvents = await raidhelper.getUserSignUps(interaction.user.id);

        if (category) {
            const channelsInCategory = category.children.cache.map(c => c.id);
            const GDKPSignUps = signUpChannelEvents.filter(signUpChannelEvent => channelsInCategory.includes(signUpChannelEvent.channelId));

            await Promise.all(GDKPSignUps.map(async(signup) => {
                const setup = await raidhelper.getSetup(signup.id);
                if (setup) {
                    setups.push({ channelid: signup.channelId, startTime: signup.startTime, ...setup });
                }
            }));

            if (setups.length < 1) botReply(interaction, 'Setups', `Momentan in keinem Setup gesetzt. Neue Setups kommen bald!`)
            else {
                // Filter Setups, sort it and only get User data
                const setupData = setups.filter((setup, index) => {
                    return setup.setup.some(user => user.userid === interaction.user.id);
                }).sort((eventA, eventB) => eventA.startTime - eventB.startTime).map(slot => ({...slot, setup: slot.setup.filter(user => user.userid === interaction.user.id) }));

                // Format Signup and get Discord Emojis for the classes
                const formattedGDKPSignUps = setupData.map(channelId => `<#${channelId.channelid}> ${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[channelId.setup[0].spec].icon)} ${extendedClassList[channelId.setup[0].spec].name}`).join(`\n`);

                botReply(interaction, 'Setups', `\n${formattedGDKPSignUps}`)
            }
        } else {
            interaction.channel.send('Pulse Bot doesnt have a correct Setup yet.');
        }
    }

    if (commandName === 'lastspent') {
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

    if (commandName === 'currentspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        const title = 'Diese ID gekauft: '
        if (!totalItems) {
            botReply(interaction, 'Diese ID gekauft:', `Keine Items gekauft in der momentanen ID. Eventuell ist die Datenbank nicht aktuell!`);
        } else {
            const formattedItems = getItemsToShow(totalItems, getWednesdayWeeksAgo(1), new Date());
            botReply(interaction, title, formattedItems)
        }
    }

    if (commandName === 'totalspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        const title = 'Gesamte Itemhistorie:'
        if (!totalItems) {
            botReply(interaction, title, `Keine Items gekauft. Eventuell ist die Datenbank nicht aktuell!`);
        } else {
            totalItems = totalItems.sort((a, b) => a.player.localeCompare(b.player))

            let i = 0,
                j = -1;
            let formattedItems = [];
            totalItems.forEach(current => {
                if (i % 15 === 0 || i === 0) {
                    formattedItems[++j] = [];
                }
                formattedItems[j].push(`${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[current.class]?.icon)} ${current.player} - [${current.item}](${current.wowhead}) - ${current.gold}g`)
                i++;
            })
            const sumOfGold = totalItems.reduce((totalGold, entry) => totalGold + entry.gold, 0);
            botReply(interaction, title,`Gesamtausgaben: **${sumOfGold}g**\n\n${formattedItems[0].join('\n')}`);

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

    if (commandName === 'signup') {
        let raidId;
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');

        for (const [key, value] of botMessages) {
            await interaction.channel.messages.fetch();
            if (raidhelper.checkIfEvent(key)) raidId = key;
            else botReply(interaction, 'Anmeldung nicht möglich', 'Keinen passenden Raid gefunden.');
        }

        try {
            const signedUpSpecs = interaction.options.getString('specs');
            const signUps = formatSignUps(signedUpSpecs);
            const formattedGDKPSignUps = signUps.map(s => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[s.specName].icon)}`).join(``);
            raidhelper.signUpToRaid(raidId, signUps, interaction.user.id);

            await botReply(interaction, 'Sign Up', `You signed up as ${formattedGDKPSignUps}\n Keep in mind, the raidhelper can take a bit until changes are shown.`);
        } catch (error) {
            console.log(error)
        }
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
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    console.log(today)
    // Calculate the number of days to subtract to get to the previous Wednesday
    const daysToSubtract = ((today.getDay() + 4) % 7) * 7 * weeks;
    console.log(daysToSubtract)
    // Subtract two weeks' worth of days and the calculated daysToSubtract
    const weeksAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000 - daysToSubtract * 24 * 60 * 60 * 1000);
    console.log(weeksAgo)
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

function getItemsFormatted(items) {
    return items.map(item => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[item.class]?.icon)} ${item.player} - [${item.item}](${item.wowhead}) - ${item.gold}g`).join(`\n`);
}

client.login(process.env.DISCORDJS_BOT_TOKEN);
