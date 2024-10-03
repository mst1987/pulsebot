const {
    showConfirmationModal,
    showBidModal,
    bidForLegendary,
} = require("../../utils/auction");

module.exports = {
    name: "bid-5k",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        bidForLegendary(client, interaction, -1, 5000);
    },
};