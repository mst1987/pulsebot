const { MessageFlags } = require("discord.js");
const { getEvent } = require("../../web/eventStore");
const { SIGNUP_BUTTON_PREFIX } = require("../../web/eventMessage");
const { checkRaiderRole } = require("../../web/signupService");
const { buildSignupDialog } = require("../../utils/signup/signupDialog");
const { toEnglish } = require("../../utils/signup/botEnglish");

// The "Anmelden" button under an EventHelper event message
// (customId `event-signup:<eventId>`, web/eventMessage.js). Opens the signup
// dialog (utils/signup/signupDialog.js) as a message only the member sees — unless the
// event's category wants a raider role the member does not have (the service's
// rule; saving refuses it again).
module.exports = {
    name: SIGNUP_BUTTON_PREFIX,
    description: "Anmelde-Button unter einer EventHelper-Event-Nachricht",
    // Signing up is for every raider; the dialog's steps inherit this access.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const eventId = String(interaction.customId || "").split(":")[1] || "";
        const event = getEvent(eventId);
        if (!event) {
            return interaction.reply({ content: "This event no longer exists.", flags: MessageFlags.Ephemeral });
        }
        const access = await checkRaiderRole(event, interaction.user.id);
        if (access.error) return interaction.reply({ content: toEnglish(access.error), flags: MessageFlags.Ephemeral });
        return interaction.reply({ ...buildSignupDialog(event, interaction.user.id), flags: MessageFlags.Ephemeral });
    },
};
