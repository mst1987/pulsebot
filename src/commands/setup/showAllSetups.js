const { getSetupsFromEvents } = require("../../utils/raidhelper");
const { botEditReply } = require("../../utils/helper");
const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const { setupResponse } = require("../../utils/responses");
const messages = require("../../config/messages");

module.exports = {
    name: "show-allsetups",
    description: "Show all setups",
    async execute(interaction, client) {
        const raidhelper = createRaidhelperClient();
        await interaction.deferReply({ ephemeral: true });
        const events = await raidhelper.getUserSignUps(interaction.user.id);
        const setups = await getSetupsFromEvents(client, interaction, events);
        let mySetup;
        if (setups.length < 1) {
            await botEditReply(
                interaction,
                messages.mysetups.errorTitle,
                messages.gdkpraids.errorMessage
            );
            return;
        } else {
            mySetup = setups
                .sort((eventA, eventB) => eventA.startTime - eventB.startTime)
                .map((event) => {
                    return setupResponse(interaction, event);
                })
                .join("\n");
        }

        await botEditReply(
            interaction,
            "Alle deine Setups auf dem Discord",
            `${mySetup}\n`
        );
        return;
    },
};
