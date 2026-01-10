/* eslint-disable indent */
const { showBidModal } = require("../../utils/auction");
const { bidForLegendary } = require("../../utils/auction");

module.exports = {
  name: "bid-custom",
  description: "Place a bid in an auction",
  async execute(interaction, client) {
    await showBidModal(interaction);
    const filter = (interaction) => interaction.customId === "bidModal";
    interaction
      .awaitModalSubmit({ filter, time: 30000 })
      .then(async (modalInteraction) => {
        const bidAmount =
          modalInteraction.fields.getTextInputValue("bidAmount");
        const bid = parseInt(bidAmount);

        if (isNaN(bid)) {
          await interaction.reply({
            content: "Bitte gib eine gültige Zahl ein.",
            ephemeral: true,
          });
          return;
        }

        bidForLegendary(client, modalInteraction, bid);
      });
  },
};
