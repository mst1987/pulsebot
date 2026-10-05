// "Fehlende pingen" under the signup message — see services/events/missingPingBot.js
// for the customIds. Access is /event's: the orga pings, everyone else is told no.
const { MISSING_PREFIX, handleMissingComponent } = require("../../services/events/missingPingBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: MISSING_PREFIX,
    description: "Knopf „Fehlende pingen“ unter der Anmelde-Nachricht",
    accessOf: "event",
    handler: handleMissingComponent,
});
