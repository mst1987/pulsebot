const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { pendingApplications } = require("../../utils/applicationState");

module.exports = {
    name: "apply-select",
    description: "Bewerbungs-Klassen Select",
    async execute(interaction, client) {
        pendingApplications.set(interaction.user.id, {
            classes: interaction.values,
            timestamp: Date.now(),
        });

        const modal = new ModalBuilder()
            .setCustomId("apply-modal")
            .setTitle("Bewerbung");

        const characterNameInput = new TextInputBuilder()
            .setCustomId("characterName")
            .setLabel("Charaktername")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50);

        const armoryInput = new TextInputBuilder()
            .setCustomId("armoryLink")
            .setLabel("Armory Link (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("https://classic.warcraftarmory.com/...")
            .setMaxLength(200);

        const logsInput = new TextInputBuilder()
            .setCustomId("logsLink")
            .setLabel("WarcraftLogs Link (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("https://classic.warcraftlogs.com/...")
            .setMaxLength(200);

        const infoInput = new TextInputBuilder()
            .setCustomId("additionalInfo")
            .setLabel("Weitere Infos (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder("Erfahrungen, Verfuegbarkeit, warum unsere Gilde, etc.")
            .setMaxLength(1000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(characterNameInput),
            new ActionRowBuilder().addComponents(armoryInput),
            new ActionRowBuilder().addComponents(logsInput),
            new ActionRowBuilder().addComponents(infoInput)
        );

        await interaction.showModal(modal);
    },
};
