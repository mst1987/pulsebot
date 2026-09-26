// The buttons and selects of "Event verwalten" (#288) — see web/eventManageBot.js
// for the customIds. Bearbeiten, Verschieben, Absagen and Löschen open their modal
// directly (a modal cannot follow a defer); the modal submits are eventManageForm.js.
const { MANAGE_PREFIX, handleComponent } = require("../../web/eventManageBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: MANAGE_PREFIX,
    description: "Knöpfe und Auswahlmenüs von Event verwalten",
    accessOf: "event",
    handler: handleComponent,
    // the error replaces the management message the button sits on
    onGuildError: "update",
});
