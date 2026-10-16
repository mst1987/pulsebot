// "Kanal umbenennen …" under the confirmation of /event anlegen: the button opens
// a modal with the channel's name, the modal submit renames it. The logic is
// services/events/eventChannelRename.js; both carry the channel id in the customId.
const { RENAME_PREFIX } = require("../../services/events/eventDraft");
const { handleRename } = require("../../services/events/eventChannelRename");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: RENAME_PREFIX,
    description: "Kanal eines neuen Events umbenennen (Knopf und Formular unter der Bestätigung von /event anlegen)",
    accessOf: "event",
    handler: handleRename,
});
