const Legendary = require("../../classes/legendary");
const { checkForPermission, botReply } = require("../../utils/helper");

module.exports = {
    name: "deleteauction",
    description: "Delete an auction",
    async execute(interaction, client) {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        const response = await legendary.deleteAuction(interaction.channel.id);

        if (response.type === "success") {
            botReply(interaction, "Auktion gelöscht", response.message);
        } else {
            botReply(interaction, "Fehler", "Ein Fehler ist vorgefallen...");
        }
    },
};