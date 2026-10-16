const { publicBaseUrl } = require("../../utils/publicUrl");
const profiles = require("../../stores/raiderProfileStore");
const { MULTI_BUTTON_ID } = require("../../services/talk/talkOverview");
const { appEmojiMap, loadAppEmojis } = require("../../services/discord/appEmojis");
const { characterOptions } = require("../../utils/signup/joinPicker");
const { createSession, getSession, signableRaids, signableVersions, buildRaidPicker } = require("../../utils/signup/multiSignup");
const { answerPayload } = require("../../utils/signup/signupReply");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { asEphemeral } = require("../../utils/discord/card");
const { versionShort } = require("../../services/events/versionTag");

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

/**
 * TBC and Forever run on the same server (#743): one signup never mixes them, so with raids of two
 * versions the bot asks which one first. The answer is the button again, with the version in the
 * customId ("<button>:v:<version>").
 */
function versionQuestion(prefix, versions, lang = "de") {
    const buttons = versions.map((id) => ({ type: 2, style: 1, custom_id: `${prefix}:v:${id}`, label: versionShort(id) }));
    return answerPayload(tr(lang, "Which game version are you signing up for?"), { components: [{ type: 1, components: buttons }], lang });
}

/**
 * The raids a talk-server button offers: those of the version in its customId, of the only version
 * there is, else the question which one (`reply`).
 * @returns {{ raids: object[] } | { reply: object }}
 */
function raidsForButton(interaction, prefix, lang = "de") {
    const versions = signableVersions();
    if (!versions.length) return { reply: noRaidsReply(lang) };
    const [, marker, asked] = String(interaction.customId || "").split(":");
    const versionId = marker === "v" && versions.includes(asked) ? asked : (versions.length === 1 ? versions[0] : "");
    if (!versionId) return { reply: versionQuestion(prefix, versions, lang) };
    return { raids: signableRaids({ versionId }) };
}

module.exports = {
    name: MULTI_BUTTON_ID,
    description: "Button „Mehrere Raids wählen …“ unter der Raid-Übersicht",
    accessOf: "talk-signup",
    noCharacterReply,
    noRaidsReply,
    versionQuestion,
    raidsForButton,
    async execute(interaction) {
        const uid = interaction.user.id;
        const lang = langOfInteraction(interaction);
        const profile = profiles.getProfile(uid) || { characters: [] };
        if (!characterOptions(profile).length) return interaction.reply(noCharacterReply(lang));
        const picked = raidsForButton(interaction, MULTI_BUTTON_ID, lang);
        if (picked.reply) return interaction.reply(asEphemeral(picked.reply));
        const raids = picked.raids;
        if (!raids.length) return interaction.reply(noRaidsReply(lang));
        const token = createSession(uid, { mode: "multi", eventIds: raids.map((e) => e.id) });
        if (interaction.client) await loadAppEmojis(interaction.client);
        const payload = buildRaidPicker(token, getSession(token, uid), raids, { emojis: appEmojiMap(), lang });
        return interaction.reply(asEphemeral(payload));
    },
};
