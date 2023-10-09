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
                name: 'createoverview',
                description: 'Creates an overview of the current category',
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
            {
                name: 'createauction',
                description: 'Creates an auction for a legendary item',
                options: [{
                        name: 'name',
                        description: 'Name der Auktion',
                        type: 3,
                        required: true
                    },
                    {
                        name: 'raid',
                        description: 'Raidbeschreibung der Auktion',
                        type: 3,
                        required: true
                    },
                    {
                        name: 'endtime',
                        description: 'Ende der Auktion (DD.MM.YY-hh:mm)',
                        type: 3,
                        required: true
                    }, {
                        name: 'mingold',
                        description: 'Startpreis der Auktion',
                        type: 3,
                        required: true
                    }, {
                        name: 'increment',
                        description: 'Mindesterhöhung der Auktion',
                        type: 3,
                        required: true
                    }
                ]
            },
            {
                name: 'updateauction',
                description: 'Updates an auction for a legendary item',
                options: [{
                        name: 'name',
                        description: 'Name der Auktion',
                        type: 3,
                    },
                    {
                        name: 'raid',
                        description: 'Raidbeschreibung der Auktion',
                        type: 3,
                    },
                    {
                        name: 'endtime',
                        description: 'Ende der Auktion (DD.MM.YY-hh:mm)',
                        type: 3,
                    }, {
                        name: 'mingold',
                        description: 'Startpreis der Auktion',
                        type: 3,
                    }, {
                        name: 'increment',
                        description: 'Mindesterhöhung der Auktion',
                        type: 3,
                    }
                ]
            },
            {
                name: 'endauction',
                description: 'Ends an auction for a legendary item',
            },
            {
                name: 'saveraid',
                description: 'Saves the Raid on pulse-gdkp.de',
            },
            {
                name: 'bid',
                description: 'Bid on a legendary item. Increment has to be high enough',
                options: [{
                    name: 'gold',
                    description: 'Wieviel Gold möchtest du bieten? Muss über dem momentanen Höchstgebot liegen',
                    type: 3,
                    required: true
                }]
            },
            {
                name: 'auctionstatus',
                description: 'Erstellt eine Auktionsübersicht',
            },
            {
                name: 'deleteauction',
                description: 'Löscht die Auktion aus diesem Channel',
            },

        ];
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands })

        console.log('Slash events registered');
    } catch (error) {
        console.log('There was an error: ' + error);
    }
})();