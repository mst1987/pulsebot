const { getEvent } = require("../../web/eventStore");
const { getSignup } = require("../../web/signupStore");
const profiles = require("../../web/raiderProfileStore");
const { submitSignup, allowedStatuses, checkRaiderRole } = require("../../web/signupService");
const {
    STATUS_PREFIX, parseStatusId, resolveState, classLabel, buildSignupDialog, buildCharacterModal,
    savedNotice, plainUpdate,
} = require("../../utils/signupDialog");

// The status buttons of the signup dialog (utils/signupDialog.js):
// `signup-status:<eventId>:<code>:<state>` — Dabei / Vielleicht / Spät / Bank /
// Abmelden. A click saves the picks carried in the customId through
// signupService.submitSignup (deadline, start, profile and spec rules all live
// there) and redraws the same message with a confirmation or the reason.
//
// Without a character in the profile the service has nothing to sign up with,
// so the click opens a modal asking for the character's name — the submitted
// modal (same customId, like logevalForce.js) adds that character with the
// picked spec to the member's profile and then signs up. Signing off needs no
// character and saves right away.
async function save(interaction, event, status, picks, character) {
    const uid = interaction.user.id;
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
        return interaction.update(buildSignupDialog(event, uid, { state: picks, notice: `⚠️ ${result.error}` }));
    }
    const profile = profiles.getProfile(uid);
    // The waiting list (#306) rides on the same line as the confirmation.
    const notice = [savedNotice(result.signup, profile), result.notice ? `⏳ ${result.notice}` : ""].filter(Boolean).join("\n");
    return interaction.update(buildSignupDialog(event, uid, { state: picks, notice }));
}

module.exports = {
    name: STATUS_PREFIX,
    description: "Status-Buttons im Anmelde-Dialog",
    accessOf: "event-signup",
    async execute(interaction) {
        const { eventId, status, state } = parseStatusId(interaction.customId);
        const event = getEvent(eventId);
        if (!event) return plainUpdate(interaction, "This event no longer exists.");
        const uid = interaction.user.id;
        if (!status) return interaction.update(buildSignupDialog(event, uid, { state, notice: "⚠️ Unknown status." }));

        const profile = profiles.getProfile(uid) || { characters: [] };
        const picks = resolveState(event, profile, getSignup(event.id, uid), state);

        if (interaction.isModalSubmit()) {
            const name = String(interaction.fields.getTextInputValue("character") || "").trim();
            const info = profiles.specInfo(picks.spec);
            if (!info) return interaction.update(buildSignupDialog(event, uid, { state: picks, notice: "⚠️ Please pick class and spec first." }));
            const added = profiles.addCharacter(uid, {
                name,
                className: info.classId,
                specs: [{ key: info.key, gear: "usable" }],
                source: "manual",
            }, { name: (interaction.member && interaction.member.displayName) || interaction.user.username || "" });
            if (added.error) return interaction.update(buildSignupDialog(event, uid, { state: picks, notice: `⚠️ ${added.error}` }));
            return save(interaction, event, status, { ...picks, character: added.character.key }, added.character.key);
        }

        if (status === "absence") return save(interaction, event, status, picks, picks.character);
        if (!picks.spec) {
            return interaction.update(buildSignupDialog(event, uid, { state: picks, notice: "⚠️ Please pick character and spec first." }));
        }
        if (!picks.character) {
            // Refused anyway (deadline, started)? Say so before asking for a name.
            if (!allowedStatuses(event).includes(status)) return save(interaction, event, status, picks, "");
            const access = await checkRaiderRole(event, uid);
            if (access.error) return interaction.update(buildSignupDialog(event, uid, { state: picks, notice: `⚠️ ${access.error}` }));
            const info = profiles.specInfo(picks.spec) || {};
            const defaultName = (interaction.member && interaction.member.displayName) || "";
            const classText = [classLabel(event, info.classId), info.labelEn || info.label].filter(Boolean).join(" · ");
            return interaction.showModal(buildCharacterModal(interaction.customId, { defaultName, classText }));
        }
        return save(interaction, event, status, picks, picks.character);
    },
};
