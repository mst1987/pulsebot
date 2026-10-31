// The buttons, selects and modals of the Orga-Zentrale of a raid category: `orga:new:<categoryId>`
// ("Raid anlegen") and the links' `orga:links|ladd|ledit|lsave|ldel:<categoryId>`.
// The logic is services/orgaHub/orgaHubBot.js; the hub is services/orgaHub/orgaHub.js.
const { componentRoute } = require("../componentRoute");
const { NEW_RAID_PREFIX } = require("../../services/orgaHub/orgaHubPanel");
const { handleOrga } = require("../../services/orgaHub/orgaHubBot");

module.exports = componentRoute({
    name: NEW_RAID_PREFIX,
    description: "Knopf „Raid anlegen“ der Orga-Zentrale",
    accessOf: "event",
    handler: handleOrga,
});
