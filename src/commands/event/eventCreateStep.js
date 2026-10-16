// The selects and buttons of /event anlegen's first step (#260):
//
//   event-new:c:<state>  category      event-new:s:<state>  other signup source
//   event-new:t:<state>  raid template event-new:b:<state>  back to step 1 (from an error)
//   event-new:k:<state>  channel mode  event-new:x:<state>  cancel
//   event-new:r:<state>  duplicated event / existing channel
//   event-new:i:<state>  channel icon (select)   event-new:j:<state>  icon button (duplicate mode: the state
//                                                carries the next choice)
//   event-new:n:<state>  "Kanalname anpassen …": the button opens a modal, the modal's submit
//                        (same customId) keeps the typed name pattern
//
// Each one redraws the message with the new state in every customId. "Weiter"
// is not here: it has to open a modal, see eventCreateModal.js.
//
// Discord wants an answer within three seconds, so every path answers FIRST (a
// modal, or deferUpdate) and only then looks at anything else — the server check
// included; its refusal goes out as an edit of the message.
const { card } = require("../../utils/discord/card");
const {
    STEP_PREFIX, parseCustomId, guildFor, applyStep, stepMessage, nameModal, namePrefill, submitNamePattern, clearNamePattern, NAME_FIELD,
} = require("../../services/events/eventDraft");

module.exports = {
    name: STEP_PREFIX,
    description: "Auswahlmenüs und Knöpfe von /event anlegen",
    accessOf: "event",
    async execute(interaction) {
        const { field, state } = parseCustomId(interaction.customId);
        const userId = String((interaction.user && interaction.user.id) || "");
        if (field === "x") {
            clearNamePattern(userId);
            return interaction.update(card({ kind: "info", title: "Abgebrochen." }));
        }

        const isSubmit = typeof interaction.isModalSubmit === "function" && interaction.isModalSubmit();
        if (field === "n" && !isSubmit) {
            // A modal can only be the direct answer to the click — nothing slow before it (the pattern is prepared in step 1).
            const { error } = guildFor(interaction);
            if (error) return interaction.reply(card({ kind: "error", title: error, ephemeral: true }));
            return interaction.showModal(nameModal(state, namePrefill(userId, state)));
        }

        // Listing a category's events can take longer than Discord's three seconds.
        await interaction.deferUpdate();
        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.editReply(card({ kind: "error", title: error }));

        let problem = "";
        if (field === "n") {
            const saved = submitNamePattern(userId, state, interaction.fields.getTextInputValue(NAME_FIELD));
            problem = saved.error || "";
        }
        const value = Array.isArray(interaction.values) ? interaction.values[0] : "";
        const next = field === "b" ? state : applyStep(state, field, value);
        const { payload } = await stepMessage(guildId, next, { userId });
        await interaction.editReply({ content: "", ...payload });
        if (problem) return interaction.followUp(card({ kind: "warn", title: problem, ephemeral: true }));
    },
};
