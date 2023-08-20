require('dotenv').config();

const classMap = require('./config/variables.js')
const shortClassList = require('./config/variables.js')
const extendedClassList = require('./config/variables.js')
const Raidhelper = require('./classes/raidhelper.js');
const GDKP = require('./classes/gdkp.js');

const { SlashCommandBuilder, Client, GatewayIntentBits, Intents } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: ['MESSAGE', 'REACTION'] });

const PREFIX = "!";

client.on('ready', () => {
    console.log('Pulse Bot is ready');
})

client.on('interactionCreate', async(interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.bot) return;

    const raidhelper = new Raidhelper();
    const guild = interaction.guild;
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

            console.log(setups.length);
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
                })
            } else {
                console.log('no setups')
                await interaction.reply({
                    embeds: [{
                        title: 'Setups',
                        description: `Momentan in keinem Setup gesetzt. Neue Setups kommen bald!`,
                    }],
                    ephemeral: true
                })
            }

        } else {
            interaction.channel.send('Pulse Bot doesnt have a correct Setup yet.');
        }
    }

    if (interaction.commandName === 'test') {
        const gdkp = new GDKP();
        let currentSpent = await gdkp.getCurrentIDSpent(interaction.user.id);
        console.log('currentSpent: ', currentSpent)
    }

    if (interaction.commandName === 'signup') {
        let signUps = [];
        let raidId = '';
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');

        for (const [key, value] of botMessages) {
            await (await interaction.channel.messages.fetch());
            if (raidhelper.checkIfEvent(key))
                raidId = key;
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

            for (let signUp of signUps) {
                console.log('Waiting...', signUp.specName)
                await raidhelper.signUpToRaid(raidId, signUp, interaction.user.id).then((responseData) => {
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
            console.log(signUps.length)

            for (let signUp of signUps) {
                console.log('Waiting...', signUp.specName)
                const response = await raidhelper.signUpToRaid(raidId, signUp, interaction.user.id).then((responseData) => {
                    console.log(signUp.specName, ' done.')
                })
            }

            const formattedGDKPSignUps = signUps.map(s => `${guild.emojis.cache.find(emoji => emoji.name === extendedClassList[s.specName].icon)}`).join(``);
            console.log(formattedGDKPSignUps);

            await interaction.reply({
                embeds: [{
                    title: 'Sign Up',
                    description: 'You signed up as \n' + formattedGDKPSignUps,
                }],
                ephemeral: true
            })
        } catch (error) {
            console.log(error)
        }

        //interaction.reply('Classes #extra:' + extraClasses)
    }
})

client.login(process.env.DISCORDJS_BOT_TOKEN);