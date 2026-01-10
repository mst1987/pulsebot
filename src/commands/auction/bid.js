const Legendary = require("../../classes/legendary");
const { bidForLegendary } = require("../../utils/auction");
const { formatTimestampToDateString } = require("../../utils/date");
const {
    botReply,
    getUserNickname,
    formatNumberWithDots,
} = require("../../utils/helper");
const {
    updateHighestBids,
    getTargetMessage,
} = require("../../utils/legendary");
const { getAuctionMessage } = require("../../utils/responses");

module.exports = {
    name: "bid",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        const bid = interaction.options.getString("gold");
        bidForLegendary(client, interaction, bid);
    },
};