const { getSetupsFromEvents } = require("../../utils/raidhelper/queries");
const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { botEditReply } = require("../../utils/discord/reply");
const { createRaidhelperClient } = require("../../utils/raidhelper/client");
const { setupResponse } = require("../../utils/setup/response");
const messages = require("../../config/messages");
const { ownSignedUpEvents } = require("../../web/eventSources");

module.exports = {
    name: "show-allsetups",
    description: "Zeigt alle Setups dieser Kategorie",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("show-allsetups")
        .setDescription("Show all setups for the current category"),
    async execute(interaction, client) {
        const raidhelper = createRaidhelperClient();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // A Raid-Helper that does not answer (or is switched off, #291) leaves the own events.
        let rhEvents = [];
        try {
            rhEvents = await raidhelper.getUserSignUps(interaction.user.id);
        } catch (error) {
            console.error("show-allsetups: Raid-Helper nicht erreichbar:", error && error.message);
        }
        // Own EventHelper events count too; getSetupsFromEvents only shows their approved setup.
        const events = [...(Array.isArray(rhEvents) ? rhEvents : []), ...ownSignedUpEvents(interaction.user.id)];
        const setups = await getSetupsFromEvents(client, interaction, events);
        let mySetup;
        if (setups.length < 1) {
            await botEditReply(
                interaction,
                messages.allsetups.errorTitle,
                messages.allsetups.errorMessage
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
