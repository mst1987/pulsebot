const { showConfirmationModal, showBidModal } = require("../../utils/auction");
const { botReply, formatNumberWithDots } = require("../../utils/helper");

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
                        content: "Bitte geben Sie eine gültige Zahl ein.",
                        ephemeral: true,
                    });
                    return;
                }

                botReply(
                    modalInteraction,
                    `**${formatNumberWithDots(Number(bidData.gold))}g**`,
                    `geboten von ${nickname}`,
                    0,
                    false
                );
            });
        console.log("modal after");
    },
};