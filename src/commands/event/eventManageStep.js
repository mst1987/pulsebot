// The buttons and selects of "Event verwalten" (#288) — see web/eventManageBot.js
// for the customIds. Bearbeiten, Verschieben and Absagen open their modal
// directly (a modal cannot follow a defer); the modal submits are eventManageForm.js.
const { MANAGE_PREFIX, handleComponent } = require("../../web/eventManageBot");
const { guildFor } = require("../../web/eventDraft");

module.exports = {
    name: MANAGE_PREFIX,
    description: "Knöpfe und Auswahlmenüs von Event verwalten",
    accessOf: "event",
    async execute(interaction) {
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.update({ content: error, embeds: [], components: [] });
        return handleComponent(interaction, guildId);
    },
};
