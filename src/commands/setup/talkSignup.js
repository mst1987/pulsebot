const { publicBaseUrl } = require("../../config/variables");
const { getStoredEvent } = require("../../web/eventSources");
const { SELECT_ID } = require("../../web/talkOverview");

// The select "Raid wählen, um dich anzumelden" under the raid overview on the
// talk server (customId `talk-signup`, web/talkOverview.js). Until the signup
// dialog in Discord exists (#258), it answers privately with a link into the
// web, where the raid can be opened.
module.exports = {
    name: SELECT_ID,
    description: "Raid-Auswahl unter der Raid-Übersicht im Kommunikations-Discord",
    // Signing up is for every raider; who may change which signup is the web's business.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const eventId = String((interaction.values && interaction.values[0]) || "").trim();
        if (!eventId) {
            return interaction.reply({ content: "Kein Raid gewählt.", ephemeral: true });
        }
        const event = getStoredEvent(eventId);
        const name = event && event.title ? `**${event.title}**` : "diesem Raid";
        const url = `${publicBaseUrl}/raids/detail?event=${encodeURIComponent(eventId)}`;
        return interaction.reply({
            content: `Die Anmeldung zu ${name} läuft über den EventHelper: ${url}`,
            ephemeral: true,
        });
    },
};
