// The buttons of the addon download centre in Discord (and of old update messages):
// `addonhub:dl|file|sub|unsub` ("Herunterladen", a file of several, "Updates
// abonnieren", "Abo beenden"). The logic is services/addons/addonCenterBot.js, the
// centre services/addons/addonCenter.js. Access as /addons (everyone by default);
// the download itself checks the web's rights. The centre may sit on the talk
// server, so no raid-server check (`guild: false`).
const { componentRoute } = require("../componentRoute");
const { CENTER_PREFIX } = require("../../services/addons/addonCenterPanel");
const { handleCenter } = require("../../services/addons/addonCenterBot");

module.exports = componentRoute({
    name: CENTER_PREFIX,
    description: "Knöpfe der Addon-Downloadzentrale (Herunterladen, Updates abonnieren)",
    accessOf: "addons",
    guild: false,
    handler: handleCenter,
});
