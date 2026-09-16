const { getEvent } = require("../../web/eventStore");
const { getSignup } = require("../../web/signupStore");
const { submitSignup } = require("../../web/signupService");
const {
    COMMENT_PREFIX, parseCommentId, buildSignupDialog, buildCommentModal, plainUpdate,
} = require("../../utils/signupDialog");

// "Kommentar" in the signup dialog (utils/signupDialog.js). Two interactions
// share the customId `signup-comment:<eventId>:<state>`, like logevalForce.js:
// the click opens a modal prefilled with the current comment, the submitted
// modal saves it onto the existing signup — status, character and spec stay as
// stored, so the deadline never stands in the way of a comment.
module.exports = {
    name: COMMENT_PREFIX,
    description: "Kommentar zur Anmeldung im Anmelde-Dialog",
    accessOf: "event-signup",
    async execute(interaction) {
        const { eventId, state } = parseCommentId(interaction.customId);
        const event = getEvent(eventId);
        const uid = interaction.user.id;
        if (!interaction.isModalSubmit()) {
            if (!event) return plainUpdate(interaction, "Dieses Event gibt es nicht mehr.");
            const mine = getSignup(event.id, uid);
            return interaction.showModal(buildCommentModal(interaction.customId, mine ? mine.comment : ""));
        }

        if (!event) return plainUpdate(interaction, "Dieses Event gibt es nicht mehr.");
        const mine = getSignup(event.id, uid);
        if (!mine) {
            return interaction.update(buildSignupDialog(event, uid, { state, notice: "⚠️ Melde dich zuerst an – dann kannst du einen Kommentar hinterlassen." }));
        }
        const comment = String(interaction.fields.getTextInputValue("comment") || "").trim();
        const result = await submitSignup(event.id, uid, {
            character: mine.character,
            spec: mine.spec,
            status: mine.status,
            canAlso: mine.canAlso || [],
            comment,
        });
        const notice = result.error
            ? `⚠️ ${result.error}`
            : (comment ? "✅ Kommentar gespeichert." : "✅ Kommentar entfernt.");
        return interaction.update(buildSignupDialog(event, uid, { state, notice }));
    },
};
