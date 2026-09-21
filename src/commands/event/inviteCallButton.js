// "Invite callen" under the setup message — see web/inviteCallBot.js for the
// customIds. Access is /event's: the orga pings, everyone else is told no.
const { MessageFlags } = require("discord.js");
const { INVITE_PREFIX, handleInviteComponent } = require("../../web/inviteCallBot");
const { guildFor } = require("../../web/eventDraft");

module.exports = {
    name: INVITE_PREFIX,
    description: "Knopf „Invite callen“ unter der Setup-Nachricht",
    accessOf: "event",
    async execute(interaction) {
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return handleInviteComponent(interaction, guildId);
    },
};
