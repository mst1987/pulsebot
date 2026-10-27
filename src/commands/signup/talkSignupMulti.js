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
const guildRoles = require("../../services/discord/guildRoles");
const { getConfig } = require("../../stores/settingsStore");

// "Mehrere Raids wählen …" under the raid overview on the talk server (#293):
// step 1, only for the member — the coming raids of the list's server (nothing
// preselected, the member picks), the status for all of them and "Weiter:
// Charaktere" (commands/signup/signupMulti.js). The button carries the list's
// source server (#904): "talk-signup-multi:<from>"; one without (posted before
// #904) offers the first server's raids as it always did.

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
 * The parts of the button's customId: "<button>[:<from>][:v:<version>]".
 * @returns {{ from: string, version: string }}
 */
function parseButtonId(customId) {
    const parts = String(customId || "").split(":").slice(1);
    const from = parts.length && parts[0] !== "v" ? parts.shift() : "";
    const version = parts[0] === "v" ? String(parts[1] || "") : "";
    return { from, version };
}

/**
 * The source server a button may name: the clicked server itself or one linked
 * to it (#892); anything else falls back to the first server (old buttons too).
 */
function sourceServer(from, here, config = getConfig()) {
    const source = String(from || "");
    if (!source) return "";
    if (source === String(here || "")) return source;
    return guildRoles.links(config).some((l) => String(l.from) === source && String(l.to) === String(here || "")) ? source : "";
}

/**
 * The raids a talk-server button offers: those of the list's server (customId,
 * #904) and of the version in its customId, of the only version there is, else
 * the question which one (`reply`) — its buttons keep the source.
 * @returns {{ raids: object[] } | { reply: object }}
 */
function raidsForButton(interaction, prefix, lang = "de") {
    const config = getConfig();
    const here = String(interaction.guildId || "");
    const parsed = parseButtonId(interaction.customId);
    const guildId = sourceServer(parsed.from, here, config);
    const scope = { config, guildId, here };
    const versions = signableVersions(scope);
    if (!versions.length) return { reply: noRaidsReply(lang) };
    const versionId = versions.includes(parsed.version) ? parsed.version : (versions.length === 1 ? versions[0] : "");
    if (!versionId) return { reply: versionQuestion(guildId ? `${prefix}:${guildId}` : prefix, versions, lang) };
    return { raids: signableRaids({ ...scope, versionId }) };
}

module.exports = {
    name: MULTI_BUTTON_ID,
    description: "Button „Mehrere Raids wählen …“ unter der Raid-Übersicht",
    accessOf: "talk-signup",
    noCharacterReply,
    noRaidsReply,
    versionQuestion,
    parseButtonId,
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
