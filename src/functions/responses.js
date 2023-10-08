const { getCharacterIcon, findServerEmoji, formatTimestampToDateString } = require('./helper.js');

module.exports = {
	setupResponse: async function (interaction, event) {
		let notInSetup = 'Setup not done yet';
		let emoji = 'copium';
		if(event.setup) {
			notInSetup = 'Not in Setup';
			emoji = 'sadcat';
		}
		const inSetup = event.setup?.find(signUp => signUp.userid === interaction.user.id);
		
		let spec;
		if(inSetup) spec = inSetup.spec;
		return `<#${event.channelid}> \n${ spec ? getCharacterIcon(interaction, spec) : findServerEmoji(interaction, emoji) } **${spec ? extendedClassList[spec].name : notInSetup}**\n${formatTimestampToDateString(event.startTime*1000)} Uhr\n`;
	  },

	mySetupResponse: function(events) {
		// Filter Setups, sort it and only get User data
		const setupData = events.filter((event, index) => {
			return event.setup?.some(user => user.userid === interaction.user.id);
		}).sort((eventA, eventB) => eventA.startTime - eventB.startTime).map(slot => ({...slot, setup: slot.setup.filter(user => user.userid === interaction.user.id) }));
		
		// Format Signup and get Discord Emojis for the classes
		return setupData.map(channel => `<#${channel.channelid}> ${getCharacterIcon(interaction, channel.setup[0].spec)} ${extendedClassList[channel.setup[0].spec].name}\n${formatTimestampToDateString(channel.startTime*1000)} Uhr\n`).join(`\n`);
	}
}