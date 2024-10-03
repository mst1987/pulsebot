const { showBidModal } = require("../../utils/auction");
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
    name: "bid-custom",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        console.log("bid custom");
        await showBidModal(interaction);
        console.log("bid custom");
        const filter = (interaction) => interaction.customId === "bidModal";
        interaction
            .awaitModalSubmit({ filter, time: 30000 })
            .then(async(modalInteraction) => {
                console.log("bid modal inner");
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
        console.log("modal after");
    },
};