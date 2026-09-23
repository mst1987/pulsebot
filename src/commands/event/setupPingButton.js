// "Alle pingen" under the setup message — see web/setupPingBot.js for the
// customIds. Access is /event's: the orga pings, everyone else is told no.
const { MessageFlags } = require("discord.js");
const { PING_PREFIX, handlePingComponent } = require("../../web/setupPingBot");
const { guildFor } = require("../../web/eventDraft");

module.exports = {
    name: PING_PREFIX,
    description: "Knopf „Alle pingen“ unter der Setup-Nachricht",
    accessOf: "event",
    async execute(interaction) {
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return handlePingComponent(interaction, guildId);
    },
};
