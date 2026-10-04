const { MessageFlags } = require("discord.js");
const { getEvent } = require("../../stores/eventStore");
const { archivedNotice } = require("../../services/events/eventArchive");
const { SIGNUP_BUTTON_PREFIX } = require("../../services/events/eventMessage");
const { checkRaiderRole } = require("../../services/signups/signupService");
const { buildSignupDialog } = require("../../utils/signup/signupDialog");
const { answerPayload } = require("../../utils/signup/signupReply");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");

// The "Anmelden" button under an EventHelper event message
// (customId `event-signup:<eventId>`, services/events/eventMessage.js). Opens the signup
// dialog (utils/signup/signupDialog.js) as a message only the member sees — unless the
// event's category wants a raider role the member does not have (the service's
// rule; saving refuses it again). Everything in the member's language.
module.exports = {
    name: SIGNUP_BUTTON_PREFIX,
    description: "Anmelde-Button unter einer EventHelper-Event-Nachricht",
    // Signing up is for every raider; the dialog's steps inherit this access.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const eventId = String(interaction.customId || "").split(":")[1] || "";
        const event = getEvent(eventId);
        const lang = langOfInteraction(interaction);
        if (!event) return interaction.reply(answerPayload(tr(lang, "This event no longer exists."), { lang }));
        const archived = archivedNotice(event, { lang });
        if (archived) return interaction.reply(answerPayload(archived, { event, lang }));
        const access = await checkRaiderRole(event, interaction.user.id);
        if (access.error) return interaction.reply(answerPayload(access.error, { event, lang }));
        return interaction.reply({ ...buildSignupDialog(event, interaction.user.id, { lang }), flags: MessageFlags.Ephemeral });
    },
};
