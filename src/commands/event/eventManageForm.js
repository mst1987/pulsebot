// The modals of "Event verwalten" (#288): Bearbeiten, Verschieben (→ preview
// with confirm buttons), Absagen and Löschen. Opened by eventManageStep.js.
const { FORM_PREFIX, handleForm } = require("../../web/eventManageBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: FORM_PREFIX,
    description: "Formulare von Event verwalten (Bearbeiten, Verschieben, Absagen, Löschen)",
    accessOf: "event",
    handler: handleForm,
});
