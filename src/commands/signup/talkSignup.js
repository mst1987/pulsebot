const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const linkCheck = require("../../services/discord/linkCheck");
const { getStoredEvent } = require("../../services/events/eventSources");
const { getEvent, isOwnEventId } = require("../../stores/eventStore");
const { archivedNotice } = require("../../services/events/eventArchive");
const { SELECT_ID } = require("../../services/talk/talkOverview");
const guildRoles = require("../../services/discord/guildRoles");
const { checkRaiderRole } = require("../../services/signups/signupService");
const { buildSignupDialog } = require("../../utils/signup/signupDialog");
const { answerPayload } = require("../../utils/signup/signupReply");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { asEphemeral } = require("../../utils/discord/card");

// The select "Raid wählen, um dich anzumelden" under the raid overview on the
// talk server (customId `talk-signup`, services/talk/talkOverview.js). An own event opens
// the signup dialog (utils/signup/signupDialog.js) right here, only for the member; a
// Raid-Helper event keeps its signup at Raid-Helper, so the answer links into
// its event channel on the event server. Every answer is in the member's language.
module.exports = {
    name: SELECT_ID,
    description: "Raid-Auswahl unter der Raid-Übersicht im Kommunikations-Discord",
    // Signing up is for every raider; the dialog's steps inherit this access.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const eventId = String((interaction.values && interaction.values[0]) || "").trim();
        const lang = langOfInteraction(interaction);
        if (!eventId) return interaction.reply(answerPayload(tr(lang, "No raid picked."), { lang }));
        if (isOwnEventId(eventId)) {
            const event = getEvent(eventId);
            if (!event) return interaction.reply(answerPayload(tr(lang, "This event no longer exists."), { lang }));
            const archived = archivedNotice(event, { lang });
            if (archived) return interaction.reply(answerPayload(archived, { event, lang }));
            // The overview is one message for everybody, so it cannot leave out a raid
            // the member may not join — the raider-role rule answers here instead.
            const access = await checkRaiderRole(event, interaction.user.id);
            if (access.error) return interaction.reply(answerPayload(access.error, { event, lang }));
            return interaction.reply(asEphemeral(buildSignupDialog(event, interaction.user.id, { lang })));
        }

        const event = getStoredEvent(eventId);
        const name = event && event.title ? `**${event.title}**` : tr(lang, "this raid");
        const guildId = (event && event.guildId) || guildRoles.eventGuildId();
        // Only a channel that exists (#537), else the web page — and that only with PUBLIC_BASE_URL.
        const channelUrl = event ? linkCheck.channelLink(guildId, event.channelId) : "";
        const url = channelUrl || linkCheck.webLink(`/raids/detail?event=${encodeURIComponent(eventId)}`);
        const text = channelUrl
            ? tr(lang, "Signups for {name} run through Raid-Helper – sign up in the event channel.", { name })
            : tr(lang, "Signups for {name} run through Raid-Helper. You can find the raid in the EventHelper.", { name });
        return interaction.reply(answerPayload(text, {
            event,
            lang,
            title: tr(lang, "Sign up at Raid-Helper"),
            components: url ? [new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(channelUrl ? tr(lang, "Go to the event channel") : tr(lang, "Open on the web"))
                .setURL(url)).toJSON()] : [],
        }));
    },
};
