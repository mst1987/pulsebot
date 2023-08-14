require('dotenv').config();

const classMap = require('./config/variables.js')
const shortClassList = require('./config/variables.js')
const extendedClassList = require('./config/variables.js')
const Raidhelper = require('./raidhelper.js');

const { SlashCommandBuilder, Client, GatewayIntentBits, Intents } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: ['MESSAGE', 'REACTION'] });

const PREFIX = "!";

client.on('ready', () => {
    console.log('bot is ready');
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    console.log(currentUnixTimestamp)
})

client.on('interactionCreate', async(interaction) => {
    if (!interaction.isChatInputCommand()) return;
    console.log(interaction.user)
    if (interaction.user.bot) return;
    const raidhelper = new Raidhelper();
    const guild = interaction.guild;
    const category = guild.channels.cache.get("1115368280245420042"); // GDKP 25er Category
    if (interaction.commandName === 'gdkpraids') {
        let signUpChannelIDs = await raidhelper.getEventData(interaction.user.id);
        let missingSignUps = await raidhelper.getMissingSignUps(interaction.user.id);

        if (category) {
            const channelsInCategory = category.children.cache.map(c => c.id); // You can change 'text' to 'voice' if needed
            const noSignUps = missingSignUps.filter(signUpChannelId => channelsInCategory.includes(signUpChannelId));
            const formattedMissingSignUps = noSignUps.map(channelId => `<#${channelId}>`).join(`\n`);

            const GDKPSignUps = signUpChannelIDs.filter(signUpChannelId => channelsInCategory.includes(signUpChannelId.channelId));

            const SignUpsWithSpecs = GDKPSignUps.map(dataObject => {
                const matchingSignUps = dataObject.signUps.filter(signUp => signUp.userId === interaction.user.id);
                const matchingSpecs = matchingSignUps.map(signUp => `${guild.emojis.cache.find(emoji => emoji.name === classMap[signUp.specName]?.icon) }`).join('');

                return {
                    specs: matchingSpecs,
                    // Include the existing data properties
                    ...dataObject,
                };
            });
            console.log(GDKPSignUps.classes)
            const formattedGDKPSignUps = SignUpsWithSpecs.map(channelId => `<#${channelId.channelId}>\n ${channelId.specs}\n`).join(`\n`);
            const reply = await interaction.reply({
                embeds: [{
                    title: 'GDKP Sign Ups',
                    description: `Missing SignUps: \n${formattedMissingSignUps}\n\nSigned Up GDKP Events: \n${formattedGDKPSignUps}`,
                }],
                ephemeral: true
            });

            setTimeout(() => {
                reply.delete();
            }, 20000)
        } else {
            interaction.reply('Error happened :(');
        }
    }
    if (interaction.commandName === 'mysetups') {
        let signUpChannelEvents = await raidhelper.getEventData(interaction.user.id);
        let setups = [];

        if (category) {
            const channelsInCategory = category.children.cache.map(c => c.id); // You can change 'text' to 'voice' if needed

            const GDKPSignUps = signUpChannelEvents.filter(signUpChannelEvent => channelsInCategory.includes(signUpChannelEvent.channelId));

            await Promise.all(GDKPSignUps.map(async(signup) => {
                const setup = await raidhelper.getSetup(signup.id);

                if (setup) {
                    setups.push({ channelid: signup.channelId, startTime: signup.startTime, ...setup });
                }
            }));
            if (setups.length > 0) {
                const filteredSetups = setups.filter((setup, index) => {
                    return setup.setup.some(user => user.userid === interaction.user.id);
                }).sort((eventA, eventB) => eventA.startTime - eventB.startTime);
                const setupData = filteredSetups.map(slot => ({...slot, setup: slot.setup.filter(user => user.userid === interaction.user.id) }));
                const guild = interaction.guild;

                const formattedGDKPSignUps = setupData.map(channelId => `<#${channelId.channelid}> ${guild.emojis.cache.find(emoji => emoji.name === classMap[channelId.setup[0].spec].icon)} ${classMap[channelId.setup[0].spec].name}`).join(`\n`);

                const reply = await interaction.reply({
                    embeds: [{
                        title: 'Setups',
                        description: `\n${formattedGDKPSignUps}`,
                    }],
                    ephemeral: true
                })

                setTimeout(() => {
                    reply.delete();
                }, 20000)
            }

        } else {
            interaction.channel.send('Category not found.');
        }
    }
    if (interaction.commandName === 'signup') {
        if (interaction.user.id !== '233598324022837249') return;
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(msg => msg.author.id === '579155972115660803');
        let raidId = '';

        for (const [key, value] of botMessages) {
            const message = await (await interaction.channel.messages.fetch());
            console.log('msg: ', key);
            if (raidhelper.checkIfEvent(key))
                raidId = key;
        }
        let signUps = []

        try {
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