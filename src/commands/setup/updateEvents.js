const { showAllEvents } = require("../../utils/helper");

module.exports = {
    name: "update-events",
    description: "Show all setups",
    async execute(interaction, client) {
        if (!interaction.channel.parent) {
            return interaction.reply({ content: "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.", ephemeral: true });
        }
        await interaction.update({
            embeds: [{
                title: interaction.channel.parent.name,
                description: await showAllEvents(
                    interaction,
                    interaction.channel.parent.id
                ),
            }, ],
        });
    },
};