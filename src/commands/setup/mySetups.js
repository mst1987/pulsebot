const Raidhelper = require("../../classes/raidhelper");
const messages = require("../../config/messages");
const { botReply, getCharacterIcon } = require("../../utils/helper");

module.exports = {
  name: "mysetups",
  description: "Show your setups",
  async execute(interaction, client) {
    const raidhelper = new Raidhelper();
    const channelsInCategory = getChannelsFromCategories(
      interaction.guild,
      categoryIds
    );
    let setups = [];
    // get all Events the user signed up for
    let signUpChannelEvents = await raidhelper.getUserSignUps(
      interaction.user.id
    );

    if (categoryIds) {
      const GDKPSignUps = signUpChannelEvents.filter((signUpChannelEvent) =>
        channelsInCategory.includes(signUpChannelEvent.channelId)
      );

      await Promise.all(
        GDKPSignUps.map(async (signup) => {
          const setup = await raidhelper.getSetup(signup.id);
          if (setup) {
            setups.push({
              channelid: signup.channelId,
              startTime: signup.startTime,
              ...setup,
            });
          }
        })
      );

      if (setups.length < 1)
        await botReply(
          interaction,
          messages.mysetups.errorTitle,
          messages.gdkpraids.errorMessage
        );
      else {
        // Filter Setups, sort it and only get User data
        const setupData = setups
          .filter((setup, index) => {
            return setup.setup.some((user) => user.id === interaction.user.id);
          })
          .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
          .map((slot) => ({
            ...slot,
            setup: slot.setup.filter((user) => user.id === interaction.user.id),
          }));

        // Format Signup and get Discord Emojis for the classes
        const formattedGDKPSignUps = setupData
          .map(
            (channelId) =>
              `<#${channelId.channelid}> ${getCharacterIcon(
                interaction,
                channelId.setup[0].spec
              )} ${extendedClassList[channelId.setup[0].spec].name}`
          )
          .join("\n");

        await botReply(
          interaction,
          messages.mysetups.errorTitle,
          `\n${formattedGDKPSignUps}`
        );
      }
    } else {
      interaction.channel.send(messages.common.pulseBotSetupError);
    }
  },
};
