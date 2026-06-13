const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

const WOW_CLASSES = [
    { label: "Warrior", value: "warrior", icon: "warrior" },
    { label: "Paladin", value: "paladin", icon: "paladin" },
    { label: "Death Knight", value: "deathknight", icon: "deathknight" },
    { label: "Hunter", value: "hunter", icon: "hunter" },
    { label: "Rogue", value: "rogue", icon: "rogue" },
    { label: "Priest", value: "priest", icon: "priest" },
    { label: "Shaman", value: "shaman", icon: "shaman" },
    { label: "Mage", value: "mage", icon: "mage" },
    { label: "Warlock", value: "warlock", icon: "warlock" },
    { label: "Druid", value: "druid", icon: "druid" },
];

module.exports = {
    name: "apply",
    description: "Bewerbungsbutton",
    async execute(interaction, client) {
        const guildEmojis = interaction.guild?.emojis.cache;

        const options = WOW_CLASSES.map(({ label, value, icon }) => {
            const option = { label, value };
            if (guildEmojis) {
                const emoji = guildEmojis.find((e) => e.name.toLowerCase() === icon.toLowerCase());
                if (emoji) option.emoji = { id: emoji.id, name: emoji.name };
            }
            return option;
        });

        const select = new StringSelectMenuBuilder()
            .setCustomId("apply-select")
            .setPlaceholder("Waehle deine Klasse(n)")
            .setMinValues(1)
            .setMaxValues(3)
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
            content: "**Schritt 1:** Waehle deine Klasse(n) aus (max. 3):",
            components: [row],
            ephemeral: true,
        });
    },
};
