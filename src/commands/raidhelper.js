require('dotenv').config();
const Raidhelper = require('../classes/raidhelper.js');
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const shortClassList = require('../config/variables.js')
const rest = new REST({ version: '10' }).setToken(process.env.DISCORDJS_BOT_TOKEN);

(async() => {
    try {
        let eventChoices = [];
        let classChoices = [];
        const raidhelper = new Raidhelper();
        events = await raidhelper.getAllEvents();

        events.forEach(event => {
            date = new Date(event.startTime * 1000);
            formattedDate = `${date.getDate()}.${date.getMonth()}.${date.getFullYear()} - ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`
            eventChoices.push({ name: event.id + ' | ' + formattedDate + ' | ' + event.title, value: event.id })
        })
        for (const clazz in shortClassList) {
            if (shortClassList.hasOwnProperty(clazz)) {
                const name = shortClassList[clazz].name;
                classChoices.push({ clazz, name, value: clazz });
            }
        };

        const commands = [{
                name: 'mysetups',
                description: 'Show the GDKP events i am in the Setup',
            },
            {
                name: 'gdkpraids',
                description: 'Show the GDKP active on the Server',
            },
            {
                name: 'lastspent',
                description: 'current',
            },
            {
                name: 'totalspent',
                description: 'current',
            },
            {
                name: 'currentspent',
                description: 'current',
            },
            /*{
                name: 'signup',
                description: 'Sign Up to a raid with classes',
                options: [{
                        name: 'raid',
                        description: 'Raid you want to sign up for',
                        type: 3,
                        required: true,
                        choices: eventChoices,
                    },
                    {
                        name: 'specs',
                        description: 'Additional Classes - Seperate with "," (Combat,Assa,Affli,Demo,Fire,RestoDruid)',
                        type: 3,
                        required: true
                    }
                ]
            },*/
            {
                name: 'signup',
                description: 'Sign Up to the raid in this channel with classes',
                options: [{
                    name: 'specs',
                    description: 'Additional Classes - Seperate with "," (Combat,Assa,Affli,Demo,Fire,RestoDruid)',
                    type: 3,
                    required: true
                }]
            },
        ];
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands })

        console.log('Slash events registered');
    } catch (error) {
        console.log('There was an error: ' + error);
    }
})();