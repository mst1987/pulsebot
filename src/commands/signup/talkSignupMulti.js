const { publicBaseUrl } = require("../../utils/publicUrl");
const profiles = require("../../stores/raiderProfileStore");
const { MULTI_BUTTON_ID } = require("../../services/talk/talkOverview");
const { appEmojiMap, loadAppEmojis } = require("../../services/discord/appEmojis");
const { characterOptions } = require("../../utils/signup/joinPicker");
const { createSession, getSession, signableRaids, buildRaidPicker } = require("../../utils/signup/multiSignup");
const { answerPayload } = require("../../utils/signup/signupReply");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { asEphemeral } = require("../../utils/discord/card");

// "Mehrere Raids wählen …" under the raid overview on the talk server (#293):
// step 1, only for the member — the coming raids (all preselected), the status
// for all of them and "Weiter: Charaktere" (commands/signup/signupMulti.js).

/** Without a profile character there is nothing to pick — the reply says where to add one. */
function noCharacterReply(lang = "de") {
    const components = /^https?:\/\//.test(publicBaseUrl())
        ? [{ type: 1, components: [{ type: 2, style: 5, label: tr(lang, "Create profile"), url: `${publicBaseUrl()}/profile` }] }]
        : [];
    return answerPayload(tr(lang, "To sign up for several raids you need characters with a spec in your profile."), { components, lang });
}

function noRaidsReply(lang = "de") {
    return answerPayload(tr(lang, "There are no coming raids with an EventHelper signup right now."), { lang });
}

module.exports = {
    name: MULTI_BUTTON_ID,
    description: "Button „Mehrere Raids wählen …“ unter der Raid-Übersicht",
    accessOf: "talk-signup",
    noCharacterReply,
    noRaidsReply,
    async execute(interaction) {
        const uid = interaction.user.id;
        const lang = langOfInteraction(interaction);
        const profile = profiles.getProfile(uid) || { characters: [] };
        if (!characterOptions(profile).length) return interaction.reply(noCharacterReply(lang));
        const raids = signableRaids();
        if (!raids.length) return interaction.reply(noRaidsReply(lang));
        const token = createSession(uid, { mode: "multi", eventIds: raids.map((e) => e.id) });
        if (interaction.client) await loadAppEmojis(interaction.client);
        const payload = buildRaidPicker(token, getSession(token, uid), raids, { emojis: appEmojiMap(), lang });
        return interaction.reply(asEphemeral(payload));
    },
};
