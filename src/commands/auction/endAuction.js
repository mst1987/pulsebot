const Legendary = require("../../classes/legendary");
const {
  checkForPermission,
  botReply,
  findServerEmoji,
} = require("../../utils/helper");
const {
  updateHighestBids,
  getTargetMessage,
} = require("../../utils/legendary");

module.exports = {
  name: "endauction",
  description: "End an auction and declare the winner",
  async execute(interaction, client) {
    if (!checkForPermission(interaction)) return;

    const legendary = new Legendary();
    const response = await legendary.getWinner(interaction.channel.id);

    if (response.type === "success") {
      botReply(
        interaction,
        "Auktion beendet!",
        `Die Auktion wurde beendet!\n\nHöchstbietender und damit Gewinner von ${findServerEmoji(
          interaction,
          "dragonwrath"
        )} **${response.legendary.name}** für den Raid **${
          response.legendary.raid
        }** ist <@${response.winner.userid}>!\n\n${findServerEmoji(
          interaction,
          "peepoParty"
        )} Gratulation und viel Spaß damit! ${findServerEmoji(
          interaction,
          "peepoParty"
        )}`,
        0,
        false
      );
      const targetMessage = await getTargetMessage(
        client,
        highestBidsChannelId,
        highestBidsMessageId
      );
      await updateHighestBids(interaction, targetMessage, legendary, client);
    } else {
      botReply(interaction, "Fehler", "Ein Fehler ist vorgefallen...");
    }
  },
};
