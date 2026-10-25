// "Who is missing?" on the softres card — see services/loot/softresMissingBot.js.
// Everybody may look who has not entered their soft reserves yet.
const { SOFTRES_MISSING_PREFIX, handleSoftresComponent } = require("../../services/loot/softresMissingBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: SOFTRES_MISSING_PREFIX,
    description: "Knopf „Wer fehlt?“ unter der Softres-Karte",
    accessOf: "event-signup",
    handler: handleSoftresComponent,
});
