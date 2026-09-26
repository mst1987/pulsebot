// "Invite callen" under the setup message — see services/setup/inviteCallBot.js for the
// customIds. Access is /event's: the orga pings, everyone else is told no.
const { INVITE_PREFIX, handleInviteComponent } = require("../../services/setup/inviteCallBot");
const { componentRoute } = require("../componentRoute");

module.exports = componentRoute({
    name: INVITE_PREFIX,
    description: "Knopf „Invite callen“ unter der Setup-Nachricht",
    accessOf: "event",
    handler: handleInviteComponent,
});
