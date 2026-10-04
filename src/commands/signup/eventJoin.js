const { MessageFlags } = require("discord.js");
const { getEvent } = require("../../stores/eventStore");
const { getSignup } = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { archivedNotice } = require("../../services/events/eventArchive");
const { submitSignup, allowedStatuses, checkRaiderRole, signupWindow, defaultCanAlso } = require("../../services/signups/signupService");
const { JOIN_SELECT_PREFIX, STATUS_OPTIONS } = require("../../services/events/eventMessage");
const { appEmojiMap, loadAppEmojis } = require("../../services/discord/appEmojis");
const { buildSignupDialog, savedNotice, plainUpdate, missingVersionLine, statusLabel } = require("../../utils/signup/signupDialog");
const { parseJoinId, characterOptions, buildJoinPicker } = require("../../utils/signup/joinPicker");
const { answerPayload } = require("../../utils/signup/signupReply");
const { savedEmbed } = require("../../utils/signup/signupButtons");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");

// The public "Anmelden …" select under an event message (#287) and the
// components of the character select it opens (utils/signup/joinPicker.js):
//
//   event-join:<eventId>                        public select, value = status
//   event-join:<eventId>:<code>:c:<state>       character · spec select (redraws only)
//   event-join:<eventId>:<code>:m:<state>       "Kann auch …" → the full signup dialog
//
// Picking a status answers only the member:
//   * Abmelden saves at once;
//   * without a profile character the dialog of #258 (class → spec → name);
//   * "Dabei" with exactly one fitting character · spec signs up at once;
//   * otherwise the character select with Anmelden / Kann auch … / Kommentar.
// Deadline, start, raider roles and the profile rules are the service's; the
// select on the message already offers only what is still allowed.
// A text answer (`{ content }`) and the save confirmation (`{ embed }`) go out as an
// embed in the raid's colour (#508, utils/signup/signupReply.js); a picker as it is.
// Everything is in the member's language (langOfInteraction).
const reply = (interaction, payload, event = null) => {
    if (payload.embed) return interaction.reply(answerPayload(payload.embed));
    if (payload.content) return interaction.reply(answerPayload(payload.content, { event, lang: langOfInteraction(interaction) }));
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
};

/** Why a status cannot be chosen right now, or "". */
function refusal(event, status, lang, now = Date.now()) {
    if (allowedStatuses(event, { now }).includes(status)) return "";
    const w = signupWindow(event, now);
    if (w.started) return tr(lang, "The raid has already started – signups are closed.");
    return tr(lang, "The signup deadline has passed – you can only sign off or sign up as “Late” now.");
}

async function emojisFor(interaction) {
    await loadAppEmojis(interaction.client);
    return appEmojiMap();
}

/** The public select: a status was picked. */
async function onStatus(interaction, event) {
    const uid = interaction.user.id;
    const lang = langOfInteraction(interaction);
    const status = String((interaction.values && interaction.values[0]) || "");
    if (!STATUS_OPTIONS[status]) return reply(interaction, { content: tr(lang, "Unknown status.") }, event);
    const refused = refusal(event, status, lang);
    if (refused) return reply(interaction, { content: refused }, event);
    const access = await checkRaiderRole(event, uid);
    if (access.error) return reply(interaction, { content: access.error }, event);

    const mine = getSignup(event.id, uid);
    const profile = profiles.getProfile(uid) || { characters: [] };
    if (status === "absence") {
        const result = await submitSignup(event.id, uid, {
            character: mine ? mine.character : "",
            spec: mine ? mine.spec : "",
            status,
            canAlso: mine ? mine.canAlso || [] : [],
            comment: mine ? mine.comment : "",
        });
        if (result.error) return reply(interaction, { content: `⚠️ ${result.error}` }, event);
        return reply(interaction, { embed: savedEmbed(event, result.signup, profiles.getProfile(uid), { emojis: await emojisFor(interaction), notice: result.notice, lang }) });
    }

    const versionId = versionOfEvent(event);
    const options = characterOptions(profile, versionId);
    if (!options.length) {
        const label = statusLabel(lang, status);
        // A profile with characters of another version only: the dialog's own line says so (#543).
        return reply(interaction, buildSignupDialog(event, uid, {
            notice: missingVersionLine(profile, versionId) ? "" : tr(lang, "Pick class and spec, then click “{label}” – the bot then asks for your character's name.", { label }),
            lang,
        }));
    }

    const emojis = await emojisFor(interaction);
    if (status === "signed" && options.length === 1) {
        const [only] = options;
        const result = await submitSignup(event.id, uid, {
            character: only.character,
            spec: only.spec,
            status,
            // Omitted = prefilled from the profile; a signup that exists keeps its own.
            canAlso: mine && mine.spec === only.spec ? mine.canAlso : undefined,
            comment: mine ? mine.comment : "",
        });
        const notice = result.error
            ? `⚠️ ${result.error}`
            : [savedNotice(result.signup, profiles.getProfile(uid), versionId, lang), result.notice ? `⏳ ${result.notice}` : ""].filter(Boolean).join("\n");
        return reply(interaction, buildJoinPicker(event, uid, status, { notice, emojis, lang }));
    }
    return reply(interaction, buildJoinPicker(event, uid, status, { emojis, lang }));
}

module.exports = {
    name: JOIN_SELECT_PREFIX,
    description: "Anmelde-Auswahl unter einer EventHelper-Event-Nachricht",
    // Signing up is for every raider; the character select's parts inherit this access.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const { eventId, status, field, state } = parseJoinId(interaction.customId);
        const event = getEvent(eventId);
        const lang = langOfInteraction(interaction);
        if (!field) {
            if (!event) return reply(interaction, { content: tr(lang, "This event no longer exists.") });
            const archived = archivedNotice(event, { lang });
            if (archived) return interaction.reply(answerPayload(archived, { event, lang }));
            return onStatus(interaction, event);
        }

        if (!event) return plainUpdate(interaction, tr(lang, "This event no longer exists."));
        const uid = interaction.user.id;
        if (!status) return plainUpdate(interaction, tr(lang, "Unknown status."));
        if (field === "m") {
            return interaction.update(buildSignupDialog(event, uid, { state, lang }));
        }
        if (field === "c") {
            const [character = "", spec = ""] = String((interaction.values && interaction.values[0]) || "").split("|");
            // The same pick keeps its "kann auch", a new one takes the profile's.
            const same = state && state.character === character && state.spec === spec;
            const next = same ? state : nextState(uid, { character, spec }, versionOfEvent(event));
            return interaction.update(buildJoinPicker(event, uid, status, { state: next, emojis: await emojisFor(interaction), lang }));
        }
        return plainUpdate(interaction, tr(lang, "Unknown action."));
    },
};

/** A freshly picked character · spec with the profile's "kann auch" (null when it is not the member's). */
function nextState(userId, pick, versionId = "") {
    const profile = profiles.getProfile(userId) || { characters: [] };
    const hit = characterOptions(profile, versionId).find((o) => o.character === pick.character && o.spec === pick.spec);
    if (!hit) return null;
    return { character: hit.character, spec: hit.spec, canAlso: defaultCanAlso(profile, hit.character, hit.spec) };
}
