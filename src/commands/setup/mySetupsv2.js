const messages = require("../../config/messages");
const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { botEditReply } = require("../../utils/helper");
const { getCategorySetups } = require("../../utils/raidhelper");
const { setupResponse } = require("../../utils/responses");

module.exports = {
  name: "show-mysetups",
  description: "Zeigt die Events, in deren Setup du stehst",
  group: "signup",
  defaultAccess: "everyone",
  data: new SlashCommandBuilder()
    .setName("show-mysetups")
    .setDescription("Show the events where I am in the setup"),
  async execute(interaction, client) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.channel.parent) {
        return botEditReply(interaction, "Fehler", "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.");
      }
      const categoryId = interaction.channel.parent.id;
      const events = await getCategorySetups(interaction, categoryId);
      const mySetup = events
        .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
        .map((event) => {
          return setupResponse(interaction, event);
        })
        .join("\n");
      await botEditReply(
        interaction,
        messages.mysetups.successTitle,
        `${mySetup}\n`
      );
    } catch (error) {
      console.log(error);
      await botEditReply(
        interaction,
        messages.general.errorTitle,
        messages.general.errorMessage
      );
    }
  },
};
