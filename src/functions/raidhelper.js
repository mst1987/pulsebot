const Raidhelper = require("../classes/raidhelper");
const { getCategoryEvents, getCharacterIcon, delay } = require("./helper");

async function getAllSignUps(interaction, categoryId) {
    var categoryEvents = await getCategoryEvents(interaction, categoryId);

    const noSignUps = getEventsWithoutSignup(categoryEvents, interaction);
    const signUps = getEventsWithSignup(categoryEvents, interaction);

    const response = {
        noSignUps: noSignUps.map(channel => `<#${channel.channelId}>`).join(`\n`),
        signUps: getSignUpsWithSpecs(signUps, interaction)
    }

    return response;
}

function getEventsWithoutSignup(events, interaction) {
    return events.filter(event => !event.signUps.find((signup) => signup.userId === interaction.user.id && signup.specName !== 'Absence'));
}

function getEventsWithSignup(events, interaction) {
    return events.filter(event => event.signUps.find((signup) => signup.userId === interaction.user.id && signup.specName !== 'Absence'));
}

async function getSignUpsWithSpecs(events, interaction) {
    const signUpsWithSpecs = events.map(event => {
        const matchingSignUps = event.signUps.filter(signUp => signUp.userId === interaction.user.id);
        const matchingSpecs = matchingSignUps.map(signUp => `${ getCharacterIcon(interaction, signUp.specName) }`).join('');

        return {
            specs: matchingSpecs,
            ...event,
        };
    });

    return signUpsWithSpecs.map(channelId => `<#${channelId.channelId}>  ${channelId.specs}\n`).join(`\n`);
}

async function getCategorySetups(interaction, categoryId) {
    let events = [];
    const raidhelper = new Raidhelper();
    var categoryEvents = await getCategoryEvents(interaction, categoryId);
    if (categoryEvents) {
        await Promise.all(categoryEvents.map(async(event) => {
            const setup = await raidhelper.getSetup(event.id);

            if (setup) {
                events.push({ channelid: event.channelId, startTime: event.startTime, ...setup });
            } else {
                events.push({ channelid: event.channelId, startTime: event.startTime });
            }
        }));

        events = events.filter((event, index) => {
            if (!event.setup) return event;
            else return event.setup.some(user => user.userid === interaction.user.id)
        });
    }
    return events;
}

async function getSetupsFromEvents(client, interaction, events) {
    let myevents = [];
    const raidhelper = new Raidhelper();
    await Promise.all(events.map(async(event) => {
        const setup = await raidhelper.getSetup(event.id);
        if (setup) {
            myevents.push({ channelid: event.channelId, startTime: event.startTime, ...setup });
        }
    }));

    myevents = myevents.filter((event, index) => {
        return event.setup.some(user => user.userid === interaction.user.id)
    });
    return myevents;
}


module.exports = {
    getAllSignUps,
    getCategorySetups,
    getSetupsFromEvents
}