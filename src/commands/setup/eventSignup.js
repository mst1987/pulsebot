const { publicBaseUrl } = require("../../config/variables");
const { getEvent } = require("../../web/eventStore");
const { SIGNUP_BUTTON_PREFIX } = require("../../web/eventMessage");

// The "Anmelden" button under an EventHelper event message
// (customId `event-signup:<eventId>`, web/eventMessage.js). Until the signup
// dialog in Discord exists (#258), it answers privately with a link into the
// web, where the event can be opened.
module.exports = {
    name: SIGNUP_BUTTON_PREFIX,
    description: "Anmelde-Button unter einer EventHelper-Event-Nachricht",
    // Signing up is for every raider; who may change which signup is the web's business.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const eventId = String(interaction.customId || "").split(":")[1] || "";
        const event = getEvent(eventId);
        if (!event) {
            return interaction.reply({ content: "Dieses Event gibt es nicht mehr.", ephemeral: true });
        }
        const url = `${publicBaseUrl}/raids/detail?event=${encodeURIComponent(event.id)}`;
        return interaction.reply({
            content: `Die Anmeldung zu **${event.title}** läuft über den EventHelper: ${url}`,
            ephemeral: true,
        });
    },
};
