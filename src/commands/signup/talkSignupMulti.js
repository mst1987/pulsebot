const { MessageFlags } = require("discord.js");
const { publicBaseUrl } = require("../../utils/publicUrl");
const profiles = require("../../stores/raiderProfileStore");
const { MULTI_BUTTON_ID } = require("../../services/talk/talkOverview");
const { appEmojiMap, loadAppEmojis } = require("../../services/discord/appEmojis");
const { characterOptions } = require("../../utils/signup/joinPicker");
const { createSession, getSession, signableRaids, buildRaidPicker } = require("../../utils/signup/multiSignup");
const { answerPayload } = require("../../utils/signup/signupReply");

// "Mehrere Raids wählen …" under the raid overview on the talk server (#293):
// step 1, only for the member — the coming raids (all preselected), the status
// for all of them and "Weiter: Charaktere" (commands/signup/signupMulti.js).

/** Without a profile character there is nothing to pick — the reply says where to add one. */
function noCharacterReply() {
    const components = /^https?:\/\//.test(publicBaseUrl())
        ? [{ type: 1, components: [{ type: 2, style: 5, label: "Create profile", url: `${publicBaseUrl()}/profile` }] }]
        : [];
    return answerPayload("To sign up for several raids you need characters with a spec in your profile.", { components });
}

function noRaidsReply() {
    return answerPayload("There are no coming raids with an EventHelper signup right now.");
}

module.exports = {
    name: MULTI_BUTTON_ID,
    description: "Button „Mehrere Raids wählen …“ unter der Raid-Übersicht",
    accessOf: "talk-signup",
    noCharacterReply,
    noRaidsReply,
    async execute(interaction) {
        const uid = interaction.user.id;
        const profile = profiles.getProfile(uid) || { characters: [] };
        if (!characterOptions(profile).length) return interaction.reply(noCharacterReply());
        const raids = signableRaids();
        if (!raids.length) return interaction.reply(noRaidsReply());
        const token = createSession(uid, { mode: "multi", eventIds: raids.map((e) => e.id) });
        if (interaction.client) await loadAppEmojis(interaction.client);
        const payload = buildRaidPicker(token, getSession(token, uid), raids, { emojis: appEmojiMap() });
        return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },
};
