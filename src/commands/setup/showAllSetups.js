const { getSetupsFromEvents } = require("../../utils/raidhelper");
const { botEditReply } = require("../../utils/helper");
const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const { setupResponse } = require("../../utils/responses");
const messages = require("../../config/messages");
const { ownSignedUpEvents } = require("../../web/eventSources");

module.exports = {
    name: "show-allsetups",
    description: "Zeigt alle Setups dieser Kategorie",
    group: "raids",
    defaultAccess: "everyone",
    async execute(interaction, client) {
        const raidhelper = createRaidhelperClient();
        await interaction.deferReply({ ephemeral: true });
        const rhEvents = await raidhelper.getUserSignUps(interaction.user.id);
        // Own EventHelper events count too; getSetupsFromEvents only shows their approved setup.
        const events = [...(Array.isArray(rhEvents) ? rhEvents : []), ...ownSignedUpEvents(interaction.user.id)];
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
