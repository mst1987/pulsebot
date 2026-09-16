// The selects and buttons of /event anlegen's first step (#260):
//
//   event-new:c:<state>  category      event-new:s:<state>  other signup source
//   event-new:t:<state>  raid template event-new:b:<state>  back to step 1 (from an error)
//   event-new:k:<state>  channel mode  event-new:x:<state>  cancel
//   event-new:r:<state>  duplicated event / existing channel
//
// Each one redraws the message with the new state in every customId. "Weiter"
// is not here: it has to open a modal, see eventCreateModal.js.
const { STEP_PREFIX, parseCustomId, guildFor, applyStep, stepMessage } = require("../../web/eventDraft");

module.exports = {
    name: STEP_PREFIX,
    description: "Auswahlmenüs und Knöpfe von /event anlegen",
    accessOf: "event",
    async execute(interaction) {
        const { field, state } = parseCustomId(interaction.customId);
        if (field === "x") return interaction.update({ content: "Abgebrochen.", embeds: [], components: [] });

        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.update({ content: error, embeds: [], components: [] });

        // Listing a category's events can take longer than Discord's three seconds.
        await interaction.deferUpdate();
        const value = Array.isArray(interaction.values) ? interaction.values[0] : "";
        const next = field === "b" ? state : applyStep(state, field, value);
        const { payload } = await stepMessage(guildId, next);
        return interaction.editReply({ content: "", ...payload });
    },
};
