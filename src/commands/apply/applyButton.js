const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { CLASSES } = require("../../config/applyClasses");

module.exports = {
    name: "apply",
    description: "Bewerbungsbutton",
    async execute(interaction) {
        const guildEmojis = interaction.guild?.emojis.cache;

        const options = CLASSES.map(({ label, value, icon }) => {
            const option = { label, value };
            if (guildEmojis) {
                const emoji = guildEmojis.find((e) => e.name.toLowerCase() === icon.toLowerCase());
                if (emoji) option.emoji = { id: emoji.id, name: emoji.name };
            }
            return option;
        });

        const select = new StringSelectMenuBuilder()
            .setCustomId("apply-class")
            .setPlaceholder("Wähle deine Klasse")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);

        await interaction.reply({
            content: "**Schritt 1:** Wähle deine Klasse:",
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },
};
