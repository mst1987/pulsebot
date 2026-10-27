// The buttons of the role messages ("Rollen-Nachrichten"): `rolemsg:<entryId>:<roleId>`
// gives or takes one role (toggle) and answers only the clicker. The logic is
// services/discord/roleMessages.js; the message may sit on any server, so no
// raid-server check. Its own entry point (nobody starts it with a slash command),
// everyone by default — the orga can narrow it under Bot-Befehle like any button. The
// reactions on the same messages follow this very rule (roleMessages.handleReaction).
const { handleRoleButton, BUTTON_PREFIX } = require("../../services/discord/roleMessages");

module.exports = {
    name: BUTTON_PREFIX,
    description: "Knöpfe der Rollen-Nachrichten (Rolle holen oder abgeben)",
    group: "channels",
    defaultAccess: "everyone",
    kind: "button",
    execute: (interaction) => handleRoleButton(interaction),
};
