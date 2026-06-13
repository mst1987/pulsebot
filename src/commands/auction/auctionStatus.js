const { botReply } = require("../../utils/helper");
const { checkForPermission } = require("../../utils/helper");

module.exports = {
    name: "auctionstatus",
    description: "Get the status of current auctions",
    async execute(interaction, client) {
        if (!checkForPermission(interaction)) return;

        botReply(interaction, "Auktionsübersicht", "", 0, false);
    },
};