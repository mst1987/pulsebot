require('dotenv').config({ path: '../.env' });

const extendedClassList = require('./config/classlist.js');
const Raidhelper = require('./classes/raidhelper.js');
const GDKP = require('./classes/gdkp.js');
const Legendary = require('./classes/legendary.js');
const messages = require('./config/messages.js');
const { DateTime } = require('luxon');

const {
    isNumber,
    delay,
    showAllEvents,
    formatNumberWithDots,
    getChannelsFromCategories,
    formatSignUps,
    botFollowup,
    botReply,
    getUserNickname,
    findServerEmoji,
    getCharacterIcon,
    checkForPermission,
    getRaidInfosFromChannel,
    formatSpecs
} = require('./functions/helper');
const { Client, GatewayIntentBits, MessageEmbed, MessageActionRow, MessageButton, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { setupResponse, getAuctionMessage } = require('./functions/responses.js');
const { getMissingSignUps, getSignUps, getCategorySetups, getSetupsFromEvents } = require('./functions/raidhelper.js');
const { getTargetMessage, updateHighestBids } = require('./functions/legendary.js');
const { toTimestamp } = require('./functions/date.js');
const { categoryIds, legendaryID, highestBidsChannelId, highestBidsMessageId } = require('./config/variables.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: ['MESSAGE', 'REACTION'] });

client.on('ready', () => {
    console.log(messages.common.pulseBotReady);
})

client.on('interactionCreate', async(interaction) => {
    const raidhelper = new Raidhelper();
    if (interaction.isButton()) {
        console.log('User: ', interaction.user.username, '- Command:', interaction.customId);
        const categoryId = interaction.channel.parent.id;

        if (interaction.customId === 'update-events') {
            await interaction.update({
                embeds: [{ title: interaction.channel.parent.name, description: await showAllEvents(interaction, categoryId) }],
            });
        }

        if (interaction.customId === 'show-signups') {
            const formattedMissingSignUps = await getMissingSignUps(interaction, categoryId);
            const formattedSignUps = await getSignUps(interaction, categoryId);

            await botReply(interaction, interaction.channel.parent.name, messages.general.missingSignups.replace('___replace___', formattedMissingSignUps) + messages.general.signups.replace('___replace___', formattedSignUps));
        }

        if (interaction.customId === 'show-mysetups') {
            const events = await getCategorySetups(interaction, categoryId);

            if (events.length < 1) {
                await botReply(interaction, messages.mysetups.errorTitle, messages.gdkpraids.errorMessage);
            } else {
                const mySetup = events.sort((eventA, eventB) => eventA.startTime - eventB.startTime).map(event => {
                    return setupResponse(interaction, event);
                }).join(`\n`)

                await botReply(interaction, messages.mysetups.successTitle, `\n${mySetup}`)
            }
        }

        if (interaction.customId === 'show-allsetups') {
            const events = await raidhelper.getUserSignUps(interaction.user.id);
            setups = await getSetupsFromEvents(client, interaction, events);
            if (setups.length < 1) {
                await botReply(interaction, messages.mysetups.errorTitle, messages.gdkpraids.errorMessage);
                return;
            } else {
                const mySetup = setups.sort((eventA, eventB) => eventA.startTime - eventB.startTime).map(async(event) => {
                    return await setupResponse(interaction, event);
                }).join(`\n`)
                console.log(interaction)
                await interaction.reply({
                        embeds: [{
                            title: 'Alle deine Setups auf dem Discord',
                            description: `${mySetup}\n`
                        }],
                        ephemeral: true
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 60000)
                    })
                    .catch(error => {
                        console.log(error);
                    });
                //await botReply(interaction, 'Alle deine Setups auf dem Discord', `${mySetup}\n`)
                return;
            }
        }
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.bot) return;

    console.log('User: ', interaction.user.username, '- Command:', interaction.commandName);

    const commandName = interaction.commandName;
    const channelsInCategory = getChannelsFromCategories(interaction.guild, categoryIds);

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
                const matchingSpecs = matchingSignUps.map(signUp => `${getCharacterIcon(interaction, signUp.specName) }`).join('');

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
                const formattedGDKPSignUps = setupData.map(channelId => `<#${channelId.channelid}> ${getCharacterIcon(interaction, channelId.setup[0].spec)} ${extendedClassList[channelId.setup[0].spec].name}`).join(`\n`);

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
            const formattedItems = getItemsToShow(interaction, totalItems, getWednesdayWeeksAgo(2), getWednesdayWeeksAgo(1));
            await botReply(interaction, messages.lastspent.successTitle, formattedItems)
        }
    }

    if (commandName === 'currentspent') {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(interaction, messages.currentspent.errorTitle, messages.currentspent.errorMessage);
        } else {
            const formattedItems = getItemsToShow(interaction, totalItems, getWednesdayWeeksAgo(1), new Date());
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
                formattedItems[j].push(`${getCharacterIcon(interaction, current.class)} ${current.player} - [${current.item}](${current.wowhead}) - ${current.gold}g`)
                i++;
            })
            const sumOfGold = totalItems.reduce((totalGold, entry) => totalGold + entry.gold, 0);
            await botReply(interaction, messages.totalspent.successTitle, `Gesamtausgaben: **${sumOfGold}g**\n\n${formattedItems[0].join('\n')}`);
            formattedItems.forEach(async(items, key) => {
                if (key > 0) {
                    await botFollowup(interaction, formattedItems[key].join('\n'))
                }
            })
        }
    }

    if (commandName === 'saveraid') {
        if (!checkForPermission(interaction)) return;
        const raidInfos = await getRaidInfosFromChannel(interaction);
        const response = await raidhelper.saveRaid(raidInfos)
        if (response._id) {
            await botReply(interaction, 'Save', `Raid gespeichert [hier](https://pulse-gdkp.de/raids/${response._id})`)
        } else {
            botReply(interaction, 'Fehler', 'Fehler beim Anlegen des Raids');
        }
    }

    if (commandName === 'signup') {
        let raidId;
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');

        for (const [key, value] of botMessages) {
            if (await raidhelper.getEvent(key)) raidId = key;
            else await botReply(interaction, messages.signup.errorTitle, messages.signup.errorMessage);
        }

        try {
            const signedUpSpecs = formatSpecs(interaction.options.getString('specs'));
            const formattedSignUps = formatSignUps(interaction, signedUpSpecs);

            await raidhelper.signUpToRaid(raidId, signedUpSpecs, interaction.user.id);

            await botReply(interaction, messages.signup.successTitle, messages.signup.successMessage.replace('___replace___', formattedSignUps));
        } catch (error) {
            console.log(error)
        }
    }

    if (commandName === 'createoverview') {
        if (!checkForPermission(interaction)) return;

        try {
            const categoryId = interaction.channel.parent.id;
            const row = new ActionRowBuilder();
            const customEmoji = findServerEmoji(interaction, 'SNIFFA');
            row.addComponents(
                new ButtonBuilder().setCustomId('update-events').setLabel('Update Events').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('show-signups').setLabel('Show my Signups').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('show-mysetups').setLabel('Show my Setups').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('show-allsetups').setLabel('Show All Setups').setStyle(ButtonStyle.Danger).setEmoji(customEmoji)
            )

            const formattedRaids = await showAllEvents(interaction, categoryId);
            botReply(interaction, interaction.channel.parent.name, formattedRaids, 0, false, [row]);
        } catch (error) {
            console.log(error);
        }
    }
    // --------------------------------------------------------

    // Legendary Bidding Commands

    if (commandName === 'bid') {
        const role = interaction.member.roles.cache.find(role => role.id === legendaryID);
        if (!role) {
            botReply(interaction, 'Fehlende Berechtigung', 'Dir fehlt die Legendary Rolle diesen Befehl auszuführen.');
            return;
        } else {
            const legendary = new Legendary();
            if (!legendary.getAuction(interaction.channel.id)) {
                botReply(interaction, 'Auktion Info', 'Keine Auktion aktiv für diesen Channel');
                return;
            }

            const gold = interaction.options.getString('gold');
            if (!isNumber(Number(gold))) {
                botReply(interaction, 'Bid Info', 'Goldwert muss eine Zahl sein!');
                return;
            }
            if (gold > 5000000) {
                botReply(interaction, 'Vertippt?', `Wolltest du wirklich **${formatNumberWithDots(gold)}g** bieten?`);
                return;
            }

            const bidData = {
                username: interaction.user.tag,
                userid: interaction.user.id,
                gold: gold,
                timestamp: DateTime.now().setZone('Europe/Paris').toMillis(),
                legendary: interaction.channel.id,
            }

            response = await legendary.bid(bidData);

            if (response.type === 'success') {
                const nickname = await getUserNickname(interaction);

                botReply(interaction, `**${formatNumberWithDots(Number(bidData.gold))}g**`, `geboten von ${nickname}`, 0, false);

                const targetMessage = getTargetMessage(client, highestBidsChannelId, highestBidsMessageId);
                if (targetMessage) {
                    updateHighestBids(interaction, targetMessage, legendary);
                }

                if (response.extended) {
                    const channelMessage = getTargetMessage(client, response.legendary.channel, response.legendary.messageid);
                    if (channelMessage) {
                        const embed = { title: `${findServerEmoji(interaction, 'poggies')} Auktion gestartet ${findServerEmoji(interaction, 'poggies')}`, description: `Auktion wurde gestartet\n\n${getAuctionMessage(interaction, response.legendary)}` };
                        await targetMessage.edit({ embeds: [embed] });
                    }
                    await botFollowup(interaction, `Die Auktion wurde verlängert und endet nun **${formatTimestampToDateString(Math.round(Number(response.legendary.endtime)))}**: <t:${Math.round(Number(response.legendary.endtime/1000))}:R>`, 0, false)
                }
            } else {
                botReply(interaction, 'Gebot nicht akzeptiert!', response.message);
            }
        }
    }

    if (commandName === 'createauction') {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        const auction = await legendary.getAuction(interaction.channel.id)

        if (auction) {
            botReply(interaction, 'Auktion Info', 'Es gibt schon eine Auktion für den Channel');
            return;
        }

        await interaction.reply({
            embeds: [{
                title: 'title',
                description: 'message'
            }],
            ephemeral: false
        })
        const replyMessage = await interaction.fetchReply()

        const auctionData = {
            name: interaction.options.getString('name'),
            raid: interaction.options.getString('raid'),
            channel: interaction.channel.id,
            messageid: replyMessage.id,
            endtime: toTimestamp(interaction.options.getString('endtime')),
            mingold: interaction.options.getString('mingold'),
            increment: interaction.options.getString('increment'),
        }

        response = await legendary.createAuction(auctionData);
        if (response.type === 'success') {
            const targetMessage = await interaction.channel.messages.fetch(replyMessage.id);
            const embed = { title: `${findServerEmoji(interaction, 'poggies')} Auktion gestartet ${findServerEmoji(interaction, 'poggies')}`, description: `Auktion wurde gestartet\n\n${getAuctionMessage(interaction,response.legendary)}` };
            const newMessage = await targetMessage.edit({ embeds: [embed] });
            await legendary.updateAuction({ messageid: newMessage.id })
        } else {
            botFollowup(interaction, response.message);
        }
    }

    if (commandName === 'updateauction') {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        let auctionData = {};
        auctionData.channel = interaction.channel.id;
        if (interaction.options.getString('name'))
            auctionData.name = interaction.options.getString('name');
        if (interaction.options.getString('raid'))
            auctionData.raid = interaction.options.getString('raid');
        if (interaction.options.getString('endtime'))
            auctionData.endtime = toTimestamp(interaction.options.getString('endtime'));
        if (interaction.options.getString('mingold'))
            auctionData.mingold = interaction.options.getString('mingold');
        if (interaction.options.getString('increment'))
            auctionData.increment = interaction.options.getString('increment');

        response = await legendary.updateAuction(auctionData);
        if (response.type === 'success') {
            const channel = await client.channels.fetch(auctionData.channel);
            if (channel) {
                const targetMessage = await channel.messages.fetch(response.legendary.messageid);
                if (targetMessage) {
                    const embed = { title: `${findServerEmoji(interaction, 'poggies')} Auktion gestartet ${findServerEmoji(interaction, 'poggies')}`, description: `Auktion wurde gestartet\n\n${getAuctionMessage(interaction, response.legendary)}` };
                    await targetMessage.edit({ embeds: [embed] });
                    botReply(interaction, `Auktion updated`, `Auktion wurde erfolgreich updated`);
                }
            }
        } else {
            botReply(interaction, 'Fehler', 'Ein Fehler ist vorgefallen...');
        }
    }

    if (commandName === 'deleteauction') {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        const response = await legendary.deleteAuction(interaction.channel.id);

        if (response.type === 'success') {
            botReply(interaction, 'Auktion gelöscht', response.message);
        } else {
            botReply(interaction, 'Fehler', 'Ein Fehler ist vorgefallen...');
        }
    }

    if (commandName === 'auctionstatus') {
        if (!checkForPermission(interaction)) return;

        botReply(interaction, 'Auktionsübersicht', '', 0, false);
    }

    if (commandName === 'endauction') {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        const response = await legendary.getWinner(interaction.channel.id);

        if (response.type === 'success') {
            botReply(interaction, 'Auktion beendet!', `Die Auktion wurde beendet!\n\nHöchstbietender und damit Gewinner von ${findServerEmoji(interaction, 'shadowmourne')} **${response.legendary.name}** für den Raid **${response.legendary.raid}** ist <@${response.winner.userid}>!\n\n${findServerEmoji(interaction, 'peepoParty')} Gratulation und viel Spaß damit! ${findServerEmoji(interaction, 'peepoParty')}`, 0, false);
        } else {
            botReply(interaction, 'Fehler', 'Ein Fehler ist vorgefallen...');
        }
    }

    // --------------------------------------------------------

})

client.login(process.env.DISCORDJS_BOT_TOKEN);