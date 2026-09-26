const { MessageFlags } = require("discord.js");
const profiles = require("../../stores/raiderProfileStore");
const { ALL_BUTTON_ID } = require("../../services/talk/talkOverview");
const { appEmojiMap, loadAppEmojis } = require("../../services/discord/appEmojis");
const { characterOptions } = require("../../utils/signup/joinPicker");
const { createSession, getSession, signableRaids, buildCharacterModal } = require("../../utils/signup/multiSignup");
const { noCharacterReply, noRaidsReply } = require("./talkSignupMulti");

// "Für alle Raids anmelden" under the raid overview on the talk server (#293):
// skips step 1 — every coming raid with an EventHelper signup is chosen — and
// opens the modal with one character select and the status for all of them
// right away (a modal can only answer a click, never a deferred one).
module.exports = {
    name: ALL_BUTTON_ID,
    description: "Button „Für alle Raids anmelden“ unter der Raid-Übersicht",
    accessOf: "talk-signup",
    async execute(interaction) {
        const uid = interaction.user.id;
        const profile = profiles.getProfile(uid) || { characters: [] };
        if (!characterOptions(profile).length) return interaction.reply(noCharacterReply());
        const raids = signableRaids();
        if (!raids.length) return interaction.reply(noRaidsReply());
        const token = createSession(uid, { mode: "all", eventIds: raids.map((e) => e.id) });
        if (interaction.client) await loadAppEmojis(interaction.client);
        const modal = buildCharacterModal(token, getSession(token, uid), 0, raids, profile, { emojis: appEmojiMap() });
        if (!modal) return interaction.reply({ ...noCharacterReply(), flags: MessageFlags.Ephemeral });
        return interaction.showModal(modal);
    },
};
