// "Confirm" / "Cancel" under the setup message — see web/setupConfirmBot.js
// for the customIds. Raider-facing: anyone may click, only their own
// placement is touched.
const { CONFIRM_PREFIX, handleConfirmComponent } = require("../../web/setupConfirmBot");

module.exports = {
    name: CONFIRM_PREFIX,
    description: "Knöpfe „Confirm“/„Cancel“ unter der Setup-Nachricht",
    accessOf: "event-signup",
    async execute(interaction) {
        return handleConfirmComponent(interaction);
    },
};
