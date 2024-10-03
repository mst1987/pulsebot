const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require("discord.js");

module.exports = {
    showBidModal,
    showConfirmationModal,
};
async function showBidModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("bidModal")
        .setTitle("Geben Sie Ihr Gebot ein");

    const bidInput = new TextInputBuilder()
        .setCustomId("bidAmount")
        .setLabel("Gebot (in Gold)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("z.B. 15000")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    const firstActionRow = new ActionRowBuilder().addComponents(bidInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

async function showConfirmationModal(interaction, bid) {
    const modal = new ModalBuilder()
        .setCustomId("confirmBidModal")
        .setTitle("Bestätigen Sie Ihr Gebot");

    const confirmInput = new TextInputBuilder()
        .setCustomId("confirmBid")
        .setLabel(`Bist du sicher, dass du ${bid} Gold bieten möchtest?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ja oder Nein")
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(confirmInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}