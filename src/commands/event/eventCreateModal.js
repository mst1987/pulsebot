// The modal of /event anlegen (#260). One customId prefix for three things, the
// way commands/logcheck/logevalForce.js does it:
//
//   button "Weiter"   event-form:<state>          → opens the modal from the template
//   button "Nochmal"  event-form:<state>:<token>  → opens it with what was typed before
//   modal submit      event-form:<state>          → creates the event
//
// A modal can only be the direct answer to a click — never after deferReply —
// so both buttons open it straight away, without a slow call first. The submit
// then defers and replaces the step message with the confirmation or the error.
const {
    FORM_PREFIX, parseCustomId, guildFor, formModal, getDraft, readForm, submitForm,
} = require("../../web/eventDraft");

module.exports = {
    name: FORM_PREFIX,
    description: "Formular von /event anlegen (Titel, Datum, Uhrzeit, Größe/T/H, Beschreibung)",
    accessOf: "event",
    async execute(interaction) {
        const { state, token } = parseCustomId(interaction.customId);
        const { guildId, error } = guildFor(interaction);

        if (!interaction.isModalSubmit()) {
            if (error) return interaction.reply({ content: error, ephemeral: true });
            const values = token ? getDraft(token, interaction.user.id) : null;
            return interaction.showModal(formModal(state, { values }));
        }

        await interaction.deferUpdate();
        if (error) return interaction.editReply({ content: error, embeds: [], components: [] });
        const { payload } = await submitForm(guildId, state, readForm(interaction), { userId: interaction.user.id });
        return interaction.editReply({ content: "", ...payload });
    },
};
