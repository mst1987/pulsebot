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
            bid = Number(highestbid.gold) + 10000;
        } else bid = 250000;
        bidForLegendary(client, interaction, bid);
    },
};
