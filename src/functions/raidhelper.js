const { getCategoryEvents } = require("./helper");

async function getMissingSignUps(categoryId) {
    var categoryEvents = await getCategoryEvents(interaction, categoryId);
    categoryEvents = categoryEvents.sort((eventA, eventB) => eventA.startTime - eventB.startTime);

    const noSignUps = categoryEvents.filter(event => !event.signUps.find((signup) => signup.userId === interaction.user.id && signup.specName !== 'Absence'));

    return noSignUps.map(channel => `<#${channel.channelId}>`).join(`\n`);
}

async function getSignUps(categoryId) {
    var categoryEvents = await getCategoryEvents(interaction, categoryId);
    categoryEvents = categoryEvents.sort((eventA, eventB) => eventA.startTime - eventB.startTime);
    const signUps = categoryEvents.filter(event => event.signUps.find((signup) => signup.userId === interaction.user.id && signup.specName !== 'Absence'));

    const signUpsWithSpecs = signUps.map(event => {
        const matchingSignUps = event.signUps.filter(signUp => signUp.userId === interaction.user.id);
        const matchingSpecs = matchingSignUps.map(signUp => `${getCharacterIcon(interaction, signUp.specName) }`).join('');

        return {
            specs: matchingSpecs,
            ...event,
        };
    });

    return signUpsWithSpecs.map(channelId => `<#${channelId.channelId}>  ${channelId.specs}\n`).join(`\n`);
}

async function getCategorySetups(categoryId) {
    let events = [];
    var categoryEvents = await getCategoryEvents(interaction, categoryId);

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

module.exports = {
    getMissingSignUps,
    getSignUps,
    getCategorySetups
}