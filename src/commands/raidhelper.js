require('dotenv').config();
const Raidhelper = require('../classes/raidhelper.js');
const { REST, Routes } = require('discord.js');
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
                description: 'Gold spent on items in the last ID',
            },
            {
                name: 'totalspent',
                description: 'Total gold spent on Items since Phase 3 Start',
            },
            {
                name: 'currentspent',
                description: 'Gold spent on items in the current ID',
            },
            {
                name: 'signup',
                description: 'Sign Up to the raid in this channel with the specs/classes you want',
                options: [{
                    name: 'specs',
                    description: 'Sign up with these Specs - Seperate with "," (example: Combat,Assa,Affli,Demo,Fire,RestoDruid)',
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