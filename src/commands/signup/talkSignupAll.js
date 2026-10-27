const { answerPayload } = require("../../utils/signup/signupReply");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { asEphemeral } = require("../../utils/discord/card");

// "Für alle Raids anmelden" was removed in #904 (too easy to sign up for raids one
// never meant). Overview messages posted before still carry the button
// ("talk-signup-all", "talk-signup-all:v:<version>"); a click only says it is gone
// and points to "Mehrere Raids wählen …" - nothing is signed up.

const OLD_BUTTON_ID = "talk-signup-all";

/** The answer to a click on the old button (ephemeral). */
function goneReply(lang = "de") {
    return asEphemeral(answerPayload(tr(lang, "This button no longer exists – use “Pick several raids …”."), { lang }));
}

module.exports = {
    name: OLD_BUTTON_ID,
    description: "Alter Button „Für alle Raids anmelden“ (entfernt in #904)",
    accessOf: "talk-signup",
    goneReply,
    async execute(interaction) {
        return interaction.reply(goneReply(langOfInteraction(interaction)));
    },
};
