const { ActionRowBuilder, ButtonBuilder } = require("discord.js");
const messages = require("../../config/messages");
const {
  findServerEmoji,
  checkForPermission,
  showAllEvents,
} = require("../../utils/helper");

module.exports = {
  name: "createoverview",
  description: "Show your setups",
  async execute(interaction, client) {
    if (!checkForPermission(interaction)) return;

    try {
      const categoryId = interaction.channel.parent.id;
      const row = new ActionRowBuilder();
      const customEmoji = findServerEmoji(interaction, "SNIFFA");
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("update-events")
          .setLabel("Update Events")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("show-signups")
          .setLabel("Show my Signups")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("show-mysetups")
          .setLabel("Show my Setups")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("show-allsetups")
          .setLabel("Show All Setups")
          .setStyle(ButtonStyle.Danger)
          .setEmoji(customEmoji)
      );

      const formattedRaids = await showAllEvents(interaction, categoryId);
      botReply(
        interaction,
        interaction.channel.parent.name,
        formattedRaids,
        0,
        false,
        [row]
      );
    } catch (error) {
      console.log(error);
    }
  },
};
