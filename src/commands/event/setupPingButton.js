// "Alle pingen" under the setup message — see web/setupPingBot.js for the
// customIds. Access is /event's: the orga pings, everyone else is told no.
const { PING_PREFIX, handlePingComponent } = require("../../web/setupPingBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: PING_PREFIX,
    description: "Knopf „Alle pingen“ unter der Setup-Nachricht",
    accessOf: "event",
    handler: handlePingComponent,
});
