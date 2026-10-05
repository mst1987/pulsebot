// Message context menu "Event verwalten" (#288): right click on the event's
// signup message → Apps → Event verwalten. Opens the same ephemeral message as
// /event verwalten, for the event whose message was clicked (else the event of
// that channel). Its `data` is a message command (no description), which
// `npm run register` collects; the router finds it by its command name.
const { MessageFlags, ContextMenuCommandBuilder, ApplicationCommandType } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { openPayload } = require("../../services/events/eventManageBot");
const { guildFor } = require("../../services/events/eventDraft");

const CONTEXT_MENU_NAME = "Event verwalten";

module.exports = {
    name: CONTEXT_MENU_NAME,
    description: "Kontextmenü an der Anmelde-Nachricht: Event verwalten",
    accessOf: "event",
    data: new ContextMenuCommandBuilder()
        .setName(CONTEXT_MENU_NAME)
        .setType(ApplicationCommandType.Message),
    async execute(interaction) {
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply(card({ kind: "error", title: error, ephemeral: true }));
        const message = interaction.targetMessage || {};
        const opened = openPayload(guildId, {
            messageId: String(message.id || interaction.targetId || ""),
            channelId: String(message.channelId || interaction.channelId || ""),
        });
        if (opened.error) return interaction.reply(card({ kind: "warn", title: opened.error, ephemeral: true }));
        return interaction.reply({ ...opened.payload, flags: (Number(opened.payload.flags) || 0) | MessageFlags.Ephemeral });
    },
};
