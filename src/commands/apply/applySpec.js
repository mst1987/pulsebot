const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { pendingApplications } = require("../../utils/applicationState");

module.exports = {
    name: "apply-spec",
    description: "Bewerbung Spec-Auswahl",
    async execute(interaction) {
        const spec = interaction.values[0];
        const pending = pendingApplications.get(interaction.user.id) || {};
        pendingApplications.set(interaction.user.id, { ...pending, spec, timestamp: Date.now() });

        const modal = new ModalBuilder().setCustomId("apply-modal").setTitle("Bewerbung");

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
            .setPlaceholder("https://classic-armory.org/...")
            .setMaxLength(300);

        const logsInput = new TextInputBuilder()
            .setCustomId("logsLink")
            .setLabel("WarcraftLogs Link (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("https://classic.warcraftlogs.com/...")
            .setMaxLength(300);

        const descriptionInput = new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Über dich / WoW-Erfahrung / Twinks")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder("Erzähl uns etwas über dich, deine WoW-Erfahrung und verlinke ggf. weitere Chars.")
            .setMaxLength(1500);

        modal.addComponents(
            new ActionRowBuilder().addComponents(characterNameInput),
            new ActionRowBuilder().addComponents(armoryInput),
            new ActionRowBuilder().addComponents(logsInput),
            new ActionRowBuilder().addComponents(descriptionInput)
        );

        await interaction.showModal(modal);
    },
};
