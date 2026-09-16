const { botReply } = require("../../utils/helper");

module.exports = {
    name: "auctionstatus",
    description: "Postet die Übersicht der laufenden Auktionen",
    group: "auctions",
    defaultAccess: "admins",
    async execute(interaction, client) {
        botReply(interaction, "Auktionsübersicht", "", 0, false);
    },
};