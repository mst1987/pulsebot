// "Alle pingen" under the setup message — see services/setup/setupPingBot.js for the
// customIds. Access is /event's: the orga pings, everyone else is told no.
const { PING_PREFIX, handlePingComponent } = require("../../services/setup/setupPingBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: PING_PREFIX,
    description: "Knopf „Alle pingen“ unter der Setup-Nachricht",
    accessOf: "event",
    handler: handlePingComponent,
});
