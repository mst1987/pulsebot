const { getEvent } = require("../../web/eventStore");
const { getSignup } = require("../../web/signupStore");
const profiles = require("../../web/raiderProfileStore");
const { defaultCanAlso } = require("../../web/signupService");
const { ROLES } = require("../../config/gameVersions/classes");
const {
    PICK_PREFIX, parsePickId, resolveState, classesFor, buildSignupDialog, plainUpdate,
} = require("../../utils/signupDialog");

// The selects of the signup dialog (utils/signupDialog.js):
//
//   signup-pick:<eventId>:k:<state>   class (only without a profile character)
//   signup-pick:<eventId>:s:<state>   character · spec ("<characterKey>|<specKey>")
//   signup-pick:<eventId>:a:<state>   "kann auch" (roles)
//
// A pick saves nothing: it only redraws the dialog with the new choice carried
// in the customIds, and the status buttons save it.
module.exports = {
    name: PICK_PREFIX,
    description: "Auswahl im Anmelde-Dialog (Klasse, Charakter · Spec, kann auch)",
    accessOf: "event-signup",
    async execute(interaction) {
        const { eventId, field, state } = parsePickId(interaction.customId);
        const event = getEvent(eventId);
        if (!event) return plainUpdate(interaction, "This event no longer exists.");
        const uid = interaction.user.id;
        const profile = profiles.getProfile(uid) || { characters: [] };
        const mine = getSignup(event.id, uid);
        const current = resolveState(event, profile, mine, state);
        const values = interaction.values || [];
        let next = current;

        if (field === "k") {
            const cls = classesFor(event).find((c) => c.id === values[0]);
            if (cls) {
                const spec = cls.specs[0].key;
                next = { character: "", spec, canAlso: current.canAlso.filter((r) => r !== cls.specs[0].role) };
            }
        } else if (field === "s") {
            const [character = "", spec = ""] = String(values[0] || "").split("|");
            const info = profiles.specInfo(spec);
            if (info) {
                const changedCharacter = character !== current.character;
                const canAlso = changedCharacter && !mine && character
                    ? defaultCanAlso(profile, character, spec)
                    : current.canAlso.filter((r) => r !== info.role);
                next = { character, spec, canAlso };
            }
        } else if (field === "a") {
            next = { ...current, canAlso: ROLES.filter((r) => values.includes(r)) };
        }

        return interaction.update(buildSignupDialog(event, uid, { state: next }));
    },
};
