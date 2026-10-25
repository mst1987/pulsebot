// "Ping now" under the "Who is missing?" list of the softres card — see
// services/loot/softresMissingBot.js. Access is /event's: the orga pings,
// everyone else is told no.
const { SOFTRES_PING_PREFIX, handleSoftresComponent } = require("../../services/loot/softresMissingBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: SOFTRES_PING_PREFIX,
    description: "Knopf „Jetzt pingen“ unter der Softres-Liste „Wer fehlt?“",
    accessOf: "event",
    handler: handleSoftresComponent,
    onGuildError: "update",
});
