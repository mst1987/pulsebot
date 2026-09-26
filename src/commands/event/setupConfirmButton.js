// "Confirm" / "Cancel" under the setup message — see services/setup/setupConfirmBot.js
// for the customIds. Raider-facing: anyone may click, only their own
// placement is touched.
const { CONFIRM_PREFIX, handleConfirmComponent } = require("../../services/setup/setupConfirmBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: CONFIRM_PREFIX,
    description: "Knöpfe „Confirm“/„Cancel“ unter der Setup-Nachricht",
    accessOf: "event-signup",
    handler: handleConfirmComponent,
    // clicked in DMs too: no server check, the customId names the event
    guild: false,
});
