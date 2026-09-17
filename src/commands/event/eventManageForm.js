// The modals of "Event verwalten" (#288): Bearbeiten, Verschieben (→ preview
// with confirm buttons), Absagen and Löschen. Opened by eventManageStep.js.
const { MessageFlags } = require("discord.js");
const { FORM_PREFIX, handleForm } = require("../../web/eventManageBot");
const { guildFor } = require("../../web/eventDraft");

module.exports = {
    name: FORM_PREFIX,
    description: "Formulare von Event verwalten (Bearbeiten, Verschieben, Absagen, Löschen)",
    accessOf: "event",
    async execute(interaction) {
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return handleForm(interaction, guildId);
    },
};
