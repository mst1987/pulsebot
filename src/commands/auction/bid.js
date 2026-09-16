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
    description: "Gebot in der Auktion dieses Kanals abgeben",
    group: "auctions",
    defaultAccess: "everyone",
    async execute(interaction, client) {
        const bid = interaction.options.getString("gold");
        bidForLegendary(client, interaction, bid);
    },
};