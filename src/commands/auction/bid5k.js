const Legendary = require("../../classes/legendary");
const {
    showConfirmationModal,
    showBidModal,
    bidForLegendary,
} = require("../../utils/auction");

module.exports = {
    name: "bid-5k",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        const legendary = new Legendary();
        const highestbid = await legendary.getHighestBid(interaction.channel.id);
        if (highestbid) {
            bid = Number(highestbid.gold) + 5000;
        } else bid = 250000;
        bidForLegendary(client, interaction, bid);
    },
};