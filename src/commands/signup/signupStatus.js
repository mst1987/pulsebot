const { getEvent } = require("../../stores/events/eventStore");
const { getSignup } = require("../../stores/events/signupStore");
const profiles = require("../../stores/roster/raiderProfileStore");
const { versionOfEvent } = require("../../services/versions/mainVersion");
const { submitSignup, allowedStatuses, checkRaiderRole } = require("../../services/signups/signupService");
const {
    STATUS_PREFIX, parseStatusId, resolveState, classLabel, buildSignupDialog, buildCharacterModal,
    savedNotice, plainUpdate,
} = require("../../utils/signup/signupDialog");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr, specLabel } = require("../../utils/i18n/botText");
const { joinHintFor } = require("../../services/signups/partnerJoinHint");
const logger = require("../../logger");

// The latest click per dialog message: the member check (#904) may wait a while,
// so an older click's hint must never redraw over a newer answer.
const latestClick = new Map();
let clickSeq = 0;

// The status buttons of the signup dialog (utils/signup/signupDialog.js):
// `signup-status:<eventId>:<code>:<state>` — Dabei / Vielleicht / Spät / Bank /
// Abmelden. A click saves the picks carried in the customId through
// signupService.submitSignup (deadline, start, profile and spec rules all live
// there) and redraws the same message with a confirmation or the reason.
//
// Without a character in the profile the service has nothing to sign up with,
// so the click opens a modal asking for the character's name — the submitted
// modal (same customId, like logevalForce.js) adds that character with the
// picked spec to the member's profile and then signs up. Signing off needs no
// character and saves right away. Everything in the member's language.
async function save(interaction, event, status, picks, character) {
    const uid = interaction.user.id;
    // Every click counts as the newest one from the start - also a sign-off or an
    // error answer - so an older click's late hint never redraws over it.
    const key = (interaction.message && interaction.message.id) || `${event.id}:${uid}`;
    const click = ++clickSeq;
    latestClick.set(key, click);
    try {
        const lang = langOfInteraction(interaction);
        const previous = getSignup(event.id, uid);
        const result = await submitSignup(event.id, uid, {
            character,
            spec: picks.spec,
            status,
            canAlso: picks.canAlso,
            // The comment is edited on its own; a status change keeps it.
            comment: previous ? previous.comment : "",
        });
        if (result.error) {
            return interaction.update(buildSignupDialog(event, uid, { state: picks, notice: `⚠️ ${result.error}`, lang }));
        }
        const profile = profiles.getProfile(uid);
        // The waiting list (#306) rides on the same line as the confirmation.
        const notice = [savedNotice(result.signup, profile, versionOfEvent(event), lang), result.notice ? `⏳ ${result.notice}` : ""].filter(Boolean).join("\n");
        await interaction.update(buildSignupDialog(event, uid, { state: picks, notice, lang }));
        // From a partner server's list (#904): someone not on the raid's server hears nothing of it
        // there, so the answer says so - checked only now, the click is answered already.
        if (result.signup.status === "absence") return undefined;
        const hint = await joinHintFor(interaction, event, { lang });
        if (!hint || latestClick.get(key) !== click) return undefined;
        return await interaction.editReply(buildSignupDialog(event, uid, { state: picks, notice: `${notice}\n${hint.line}`, lang, joinButton: hint.button }))
            .catch((e) => logger.debug(`signup-status: join hint not shown (${e && e.message})`));
    } finally {
        if (latestClick.get(key) === click) latestClick.delete(key);
    }
}

module.exports = {
    name: STATUS_PREFIX,
    description: "Status-Buttons im Anmelde-Dialog",
    accessOf: "event-signup",
    async execute(interaction) {
        const { eventId, status, state } = parseStatusId(interaction.customId);
        const event = getEvent(eventId);
        const lang = langOfInteraction(interaction);
        if (!event) return plainUpdate(interaction, tr(lang, "This event no longer exists."));
        const uid = interaction.user.id;
        const warn = (text, picks) => interaction.update(buildSignupDialog(event, uid, { state: picks, notice: `⚠️ ${text}`, lang }));
        if (!status) return warn(tr(lang, "Unknown status."), state);

        const profile = profiles.getProfile(uid) || { characters: [] };
        const picks = resolveState(event, profile, getSignup(event.id, uid), state);

        if (interaction.isModalSubmit()) {
            const name = String(interaction.fields.getTextInputValue("character") || "").trim();
            const info = profiles.specInfo(picks.spec);
            if (!info) return warn(tr(lang, "Please pick class and spec first."), picks);
            const added = profiles.addCharacter(uid, {
                name,
                className: info.classId,
                specs: [{ key: info.key, gear: "usable" }],
                source: "manual",
            }, { name: (interaction.member && interaction.member.displayName) || interaction.user.username || "", versionId: versionOfEvent(event) });
            if (added.error) return warn(added.error, picks);
            return save(interaction, event, status, { ...picks, character: added.character.key }, added.character.key);
        }

        if (status === "absence") return save(interaction, event, status, picks, picks.character);
        if (!picks.spec) {
            return warn(tr(lang, "Please pick character and spec first."), picks);
        }
        if (!picks.character) {
            // Refused anyway (deadline, started)? Say so before asking for a name.
            if (!allowedStatuses(event).includes(status)) return save(interaction, event, status, picks, "");
            const access = await checkRaiderRole(event, uid);
            if (access.error) return warn(access.error, picks);
            const info = profiles.specInfo(picks.spec) || {};
            const defaultName = (interaction.member && interaction.member.displayName) || "";
            const classText = [classLabel(event, info.classId, lang), specLabel(lang, info)].filter(Boolean).join(" · ");
            return interaction.showModal(buildCharacterModal(interaction.customId, { defaultName, classText, versionId: versionOfEvent(event), lang }));
        }
        return save(interaction, event, status, picks, picks.character);
    },
};
