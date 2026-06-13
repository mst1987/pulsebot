const Legendary = require("../../classes/legendary");
const {
    showConfirmationModal,
    showBidModal,
    bidForLegendary,
} = require("../../utils/auction");

module.exports = {
    name: "bid-10k",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        const legendary = new Legendary();
        const highestbid = await legendary.getHighestBid(interaction.channel.id);
        if (highestbid) {
            const bid = Number(highestbid.gold) + 10000;
            bidForLegendary(client, interaction, bid);
        } else {
            bidForLegendary(client, interaction, 250000);
        }
    },
};
