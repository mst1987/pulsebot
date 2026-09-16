const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { publicBaseUrl } = require("../../config/variables");
const { getStoredEvent } = require("../../web/eventSources");
const { getEvent, isOwnEventId } = require("../../web/eventStore");
const { SELECT_ID } = require("../../web/talkOverview");
const guildRoles = require("../../web/guildRoles");
const { checkRaiderRole } = require("../../web/signupService");
const { buildSignupDialog } = require("../../utils/signupDialog");

// The select "Raid wählen, um dich anzumelden" under the raid overview on the
// talk server (customId `talk-signup`, web/talkOverview.js). An own event opens
// the signup dialog (utils/signupDialog.js) right here, only for the member; a
// Raid-Helper event keeps its signup at Raid-Helper, so the answer links into
// its event channel on the event server.
module.exports = {
    name: SELECT_ID,
    description: "Raid-Auswahl unter der Raid-Übersicht im Kommunikations-Discord",
    // Signing up is for every raider; the dialog's steps inherit this access.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const eventId = String((interaction.values && interaction.values[0]) || "").trim();
        if (!eventId) {
            return interaction.reply({ content: "Kein Raid gewählt.", flags: MessageFlags.Ephemeral });
        }
        if (isOwnEventId(eventId)) {
            const event = getEvent(eventId);
            if (!event) return interaction.reply({ content: "Dieses Event gibt es nicht mehr.", flags: MessageFlags.Ephemeral });
            // The overview is one message for everybody, so it cannot leave out a raid
            // the member may not join — the raider-role rule answers here instead.
            const access = await checkRaiderRole(event, interaction.user.id);
            if (access.error) return interaction.reply({ content: access.error, flags: MessageFlags.Ephemeral });
            return interaction.reply({ ...buildSignupDialog(event, interaction.user.id), flags: MessageFlags.Ephemeral });
        }

        const event = getStoredEvent(eventId);
        const name = event && event.title ? `**${event.title}**` : "diesem Raid";
        const guildId = (event && event.guildId) || guildRoles.eventGuildId();
        const channelUrl = event && event.channelId && guildId
            ? `https://discord.com/channels/${guildId}/${event.channelId}`
            : "";
        const base = String(publicBaseUrl || "").replace(/\/+$/, "");
        const url = channelUrl || `${base}/raids/detail?event=${encodeURIComponent(eventId)}`;
        return interaction.reply({
            content: channelUrl
                ? `Die Anmeldung zu ${name} läuft über Raid-Helper – melde dich im Event-Kanal an.`
                : `Die Anmeldung zu ${name} läuft über Raid-Helper. Den Raid findest du im EventHelper.`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(channelUrl ? "Zum Event-Kanal" : "Im Web öffnen")
                .setURL(url)).toJSON()],
            flags: MessageFlags.Ephemeral,
        });
    },
};
