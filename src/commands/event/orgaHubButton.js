// "Raid anlegen" on the Orga-Zentrale of a raid category: `orga:new:<categoryId>`.
// The logic is services/events/orgaHubBot.js; the hub is services/events/orgaHub.js.
const { componentRoute } = require("../componentRoute");
const { NEW_RAID_PREFIX } = require("../../services/events/orgaHubPanel");
const { openCreateFlow } = require("../../services/events/orgaHubBot");

module.exports = componentRoute({
    name: NEW_RAID_PREFIX,
    description: "Knopf „Raid anlegen“ der Orga-Zentrale",
    accessOf: "event",
    handler: openCreateFlow,
});
