const { getEvent } = require("../../web/eventStore");
const { SIGNUP_BUTTON_PREFIX } = require("../../web/eventMessage");
const { buildSignupDialog } = require("../../utils/signupDialog");

// The "Anmelden" button under an EventHelper event message
// (customId `event-signup:<eventId>`, web/eventMessage.js). Opens the signup
// dialog (utils/signupDialog.js) as a message only the member sees.
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
            return interaction.reply({ content: "Dieses Event gibt es nicht mehr.", ephemeral: true });
        }
        return interaction.reply({ ...buildSignupDialog(event, interaction.user.id), ephemeral: true });
    },
};
