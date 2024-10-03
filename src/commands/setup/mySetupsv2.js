const { getCategorySetups } = require("../../functions/raidhelper");
const { botEditReply } = require("../../utils/helper");

module.exports = {
    name: "show-mysetups",
    description: "Show your setups",
    async execute(interaction, client) {
        try {
            await interaction.deferReply({ ephemeral: true });
            const events = await getCategorySetups(interaction, categoryId);
            const mySetup = events
                .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
                .map((event) => {
                    return setupResponse(interaction, event);
                })
                .join(`\n`);
            await botEditReply(
                interaction,
                messages.mysetups.successTitle,
                `${mySetup}\n`
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