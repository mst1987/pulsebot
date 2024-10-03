const { getAllSignUps } = require("../../utils/raidhelper");
const { botEditReply } = require("../../utils/helper");

module.exports = {
    name: "show-signups",
    description: "Show all setups",
    async execute(interaction, client) {
        try {
            await interaction.deferReply({ ephemeral: true });
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