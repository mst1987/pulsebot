const { getAllSignUps } = require("../../utils/raidhelper");
const { botEditReply } = require("../../utils/helper");
const messages = require("../../config/messages");

module.exports = {
    name: "show-signups",
    description: "Show all setups",
    async execute(interaction, client) {
        try {
            await interaction.deferReply({ ephemeral: true });
            if (!interaction.channel.parent) {
                return botEditReply(interaction, "Fehler", "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.");
            }
            const categoryId = interaction.channel.parent.id;
            const formattedSignUps = await getAllSignUps(interaction, categoryId);
            await botEditReply(
                interaction,
                interaction.channel.parent.name,
                messages.general.missingSignups.replace(
                    "___replace___",
                    formattedSignUps.noSignUps
                ) +
                messages.general.signups.replace(
                    "___replace___",
                    formattedSignUps.signUps
                )
            );
        } catch (error) {
            await botEditReply(
                interaction,
                messages.general.errorTitle,
                messages.general.errorMessage
            );
        }
    },
};