// Message context menu "Event verwalten" (#288): right click on the event's
// signup message → Apps → Event verwalten. Opens the same ephemeral message as
// /event verwalten, for the event whose message was clicked (else the event of
// that channel). Registered as a message command (type 3) in
// scripts/register-commands.js; the router finds it by its command name.
const { MessageFlags } = require("discord.js");
const { openPayload } = require("../../web/eventManageBot");
const { guildFor } = require("../../web/eventDraft");

const CONTEXT_MENU_NAME = "Event verwalten";

module.exports = {
    name: CONTEXT_MENU_NAME,
    description: "Kontextmenü an der Anmelde-Nachricht: Event verwalten",
    accessOf: "event",
    async execute(interaction) {
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        const message = interaction.targetMessage || {};
        const opened = openPayload(guildId, {
            messageId: String(message.id || interaction.targetId || ""),
            channelId: String(message.channelId || interaction.channelId || ""),
        });
        if (opened.error) return interaction.reply({ content: opened.error, flags: MessageFlags.Ephemeral });
        return interaction.reply({ ...opened.payload, flags: MessageFlags.Ephemeral });
    },
};
