const { showConfirmationModal, showBidModal } = require("../../utils/auction");

module.exports = {
    name: "bid-custom",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        console.log("bid custom");
        await showBidModal(interaction);
        console.log("bid custom");
        if (interaction.isModalSubmit()) {
            console.log("bid modal");
            if (interaction.customId === "bidModal") {
                const bidAmount = interaction.fields.getTextInputValue("bidAmount");
                const bid = parseInt(bidAmount);

                if (isNaN(bid)) {
                    await interaction.reply({
                        content: "Bitte geben Sie eine gültige Zahl ein.",
                        ephemeral: true,
                    });
                    return;
                }

                // Speichern Sie das Gebot temporär
                pendingBids.set(interaction.user.id, bid);

                // Zeigen Sie das Bestätigungsmodal
                await showConfirmationModal(interaction, bid);
            } else if (interaction.customId === "confirmBidModal") {
                const confirmation = interaction.fields
                    .getTextInputValue("confirmBid")
                    .toLowerCase();
                const bid = pendingBids.get(interaction.user.id);

                if (confirmation === "ja") {
                    // Hier implementieren Sie die Logik zum Platzieren des Gebots
                    await interaction.reply({
                        content: `Ihr Gebot von ${bid} Gold wurde erfolgreich platziert!`,
                        ephemeral: true,
                    });
                } else {
                    await interaction.reply({
                        content: "Gebot abgebrochen.",
                        ephemeral: true,
                    });
                }

                // Entfernen Sie das ausstehende Gebot
                pendingBids.delete(interaction.user.id);
            }
        }
    },
};