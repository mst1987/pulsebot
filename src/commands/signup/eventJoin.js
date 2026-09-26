const { MessageFlags } = require("discord.js");
const { getEvent } = require("../../stores/eventStore");
const { getSignup } = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { submitSignup, allowedStatuses, checkRaiderRole, signupWindow, defaultCanAlso } = require("../../web/signupService");
const { JOIN_SELECT_PREFIX, STATUS_OPTIONS } = require("../../web/eventMessage");
const { appEmojiMap, loadAppEmojis } = require("../../web/appEmojis");
const { buildSignupDialog, savedNotice, plainUpdate } = require("../../utils/signup/signupDialog");
const { parseJoinId, characterOptions, buildJoinPicker } = require("../../utils/signup/joinPicker");
const { toEnglish } = require("../../utils/signup/botEnglish");

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
const reply = (interaction, payload) => interaction.reply({
    ...payload,
    ...(payload.content ? { content: toEnglish(payload.content) } : {}),
    flags: MessageFlags.Ephemeral,
});

/** Why a status cannot be chosen right now, or "". */
function refusal(event, status, now = Date.now()) {
    if (allowedStatuses(event, { now }).includes(status)) return "";
    const w = signupWindow(event, now);
    if (w.started) return "The raid has already started – signups are closed.";
    return "The signup deadline has passed – you can only sign off or sign up as “Late” now.";
}

async function emojisFor(interaction) {
    await loadAppEmojis(interaction.client);
    return appEmojiMap();
}

/** The public select: a status was picked. */
async function onStatus(interaction, event) {
    const uid = interaction.user.id;
    const status = String((interaction.values && interaction.values[0]) || "");
    if (!STATUS_OPTIONS[status]) return reply(interaction, { content: "Unknown status." });
    const refused = refusal(event, status);
    if (refused) return reply(interaction, { content: refused });
    const access = await checkRaiderRole(event, uid);
    if (access.error) return reply(interaction, { content: access.error });

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
        return reply(interaction, { content: result.error ? `⚠️ ${result.error}` : "✅ Signed off." });
    }

    const options = characterOptions(profile);
    if (!options.length) {
        const label = STATUS_OPTIONS[status].label;
        return reply(interaction, buildSignupDialog(event, uid, {
            notice: `Pick class and spec, then click “${label}” – the bot then asks for your character's name.`,
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
            : [savedNotice(result.signup, profiles.getProfile(uid)), result.notice ? `⏳ ${result.notice}` : ""].filter(Boolean).join("\n");
        return reply(interaction, buildJoinPicker(event, uid, status, { notice, emojis }));
    }
    return reply(interaction, buildJoinPicker(event, uid, status, { emojis }));
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
        if (!field) {
            if (!event) return reply(interaction, { content: "This event no longer exists." });
            return onStatus(interaction, event);
        }

        if (!event) return plainUpdate(interaction, "This event no longer exists.");
        const uid = interaction.user.id;
        if (!status) return plainUpdate(interaction, "Unknown status.");
        if (field === "m") {
            return interaction.update(buildSignupDialog(event, uid, { state }));
        }
        if (field === "c") {
            const [character = "", spec = ""] = String((interaction.values && interaction.values[0]) || "").split("|");
            // The same pick keeps its "kann auch", a new one takes the profile's.
            const same = state && state.character === character && state.spec === spec;
            const next = same ? state : nextState(uid, { character, spec });
            return interaction.update(buildJoinPicker(event, uid, status, { state: next, emojis: await emojisFor(interaction) }));
        }
        return plainUpdate(interaction, "Unknown action.");
    },
};

/** A freshly picked character · spec with the profile's "kann auch" (null when it is not the member's). */
function nextState(userId, pick) {
    const profile = profiles.getProfile(userId) || { characters: [] };
    const hit = characterOptions(profile).find((o) => o.character === pick.character && o.spec === pick.spec);
    if (!hit) return null;
    return { character: hit.character, spec: hit.spec, canAlso: defaultCanAlso(profile, hit.character, hit.spec) };
}
