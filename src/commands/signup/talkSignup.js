const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { publicBaseUrl } = require("../../utils/publicUrl");
const { getStoredEvent } = require("../../services/events/eventSources");
const { getEvent, isOwnEventId } = require("../../stores/eventStore");
const { SELECT_ID } = require("../../services/talk/talkOverview");
const guildRoles = require("../../services/discord/guildRoles");
const { checkRaiderRole } = require("../../services/signups/signupService");
const { buildSignupDialog } = require("../../utils/signup/signupDialog");
const { answerPayload } = require("../../utils/signup/signupReply");

// The select "Raid wählen, um dich anzumelden" under the raid overview on the
// talk server (customId `talk-signup`, services/talk/talkOverview.js). An own event opens
// the signup dialog (utils/signup/signupDialog.js) right here, only for the member; a
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
        if (!eventId) return interaction.reply(answerPayload("No raid picked."));
        if (isOwnEventId(eventId)) {
            const event = getEvent(eventId);
            if (!event) return interaction.reply(answerPayload("This event no longer exists."));
            // The overview is one message for everybody, so it cannot leave out a raid
            // the member may not join — the raider-role rule answers here instead.
            const access = await checkRaiderRole(event, interaction.user.id);
            if (access.error) return interaction.reply(answerPayload(access.error, { event }));
            return interaction.reply({ ...buildSignupDialog(event, interaction.user.id), flags: MessageFlags.Ephemeral });
        }

        const event = getStoredEvent(eventId);
        const name = event && event.title ? `**${event.title}**` : "this raid";
        const guildId = (event && event.guildId) || guildRoles.eventGuildId();
        const channelUrl = event && event.channelId && guildId
            ? `https://discord.com/channels/${guildId}/${event.channelId}`
            : "";
        const base = publicBaseUrl();
        const url = channelUrl || `${base}/raids/detail?event=${encodeURIComponent(eventId)}`;
        const text = channelUrl
            ? `Signups for ${name} run through Raid-Helper – sign up in the event channel.`
            : `Signups for ${name} run through Raid-Helper. You can find the raid in the EventHelper.`;
        return interaction.reply(answerPayload(text, {
            event,
            title: "Sign up at Raid-Helper",
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(channelUrl ? "Go to the event channel" : "Open on the web")
                .setURL(url)).toJSON()],
        }));
    },
};
