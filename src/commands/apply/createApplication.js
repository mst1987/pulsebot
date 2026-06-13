const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { checkForPermission, botReply } = require("../../utils/helper");

module.exports = {
    name: "createapplication",
    description: "Erstellt eine Bewerbungsnachricht mit Apply-Button",
    async execute(interaction, client) {
        if (!checkForPermission(interaction)) return;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("apply")
                .setLabel("Jetzt bewerben")
                .setStyle(ButtonStyle.Success)
        );

        await botReply(
            interaction,
            "Gilde beitreten",
            "Moechtest du unserer Gilde beitreten? Klicke auf den Button und fuelle das Bewerbungsformular aus!",
            0,
            false,
            [row]
        );
    },
};
